import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createIsolatedSandboxProvider } from "@ai-hero/sandcastle";

const PLACEHOLDER = "sbx-gh-placeholder";
const WORKSPACE = "/home/agent/workspace";

const sbx = (args: string[], input = "") =>
  execFileSync("sbx", args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }).trim();

// Every create() gets a fresh sbx microVM with NO host mount: Sandcastle copies the repo in
// as a git bundle and brings commits back as patches. The VM has its own dockerd, so
// Testcontainers works without the Mac's Docker socket.
export function sbxIsolated(options: {
  stack: "node" | "jdk25"; // which frehen/sbx-<stack>:stable image to run
  name: string; // sandbox name prefix, e.g. "loop-crash-fork"
  ghKeychainItem: string; // Keychain item holding the fine-grained PAT
  env?: Record<string, string>;
  // Drill only: import this credential instead of a fresh export; null = import nothing.
  copilotAuth?: string | null;
}) {
  return createIsolatedSandboxProvider({
    name: "sbx-isolated",
    env: options.env,
    create: async ({ env }) => {
      // The provider supplies both credentials itself. A real value from the shell
      // (e.g. under with-secrets.sh) would be passed with "sbx exec -e" and land in the VM.
      for (const key of ["GH_TOKEN", "OPENCODE_AUTH_B64"]) {
        if (key in env) throw new Error(`sbxIsolated: ${key} must not be set; run without with-secrets.sh`);
      }

      // Unique per create(), so the loop and an interactive session never collide.
      const name = `${options.name}-${randomUUID().slice(0, 8)}`;

      // Remove the VM (and with it the sandbox-scoped secret) on any exit, Ctrl-C included.
      const removeOnExit = () => {
        try {
          execFileSync("sbx", ["rm", "--force", name], { stdio: "ignore" });
        } catch {}
      };
      const onSignal = () => process.exit(130);
      process.once("exit", removeOnExit);
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);

      // GH_TOKEN: the proxy swaps the placeholder for the PAT on api.github.com only.
      // The PAT stays in the Keychain and sbx's secret store, never in the VM or in argv.
      sbx([
        "secret", "set-custom", "--sandbox", name,
        "--host", "api.github.com", "--env", "GH_TOKEN", "--placeholder", PLACEHOLDER,
        "--command", `security find-generic-password -s ${options.ghKeychainItem} -w`,
      ]);
      sbx([
        "create", "--name", name, "--no-progress",
        "-t", `frehen/sbx-${options.stack}:stable`,
        "-e", `GH_TOKEN=${PLACEHOLDER}`,
        "opencode", // no PATH: nothing from the Mac is mounted
      ]);

      // Copilot: a fresh export from the host's opencode.db, piped in over stdin.
      const copilot =
        options.copilotAuth === undefined
          ? execFileSync("opencode", ["auth", "export", "github-copilot"], { encoding: "utf8" })
          : options.copilotAuth;
      if (copilot !== null) sbx(["exec", "-i", name, "opencode", "auth", "import", "--standalone"], copilot);

      return {
        worktreePath: WORKSPACE,
        sandboxId: name,
        exec: (command, opts = {}) =>
          new Promise((resolve, reject) => {
            // "-e KEY" without a value: sbx reads it from our env, so values stay out of argv
            // and out of sbx's sandbox state.
            const args = ["exec", "-i", "-w", opts.cwd ?? "/home/agent"];
            for (const key of Object.keys(env)) args.push("-e", key);
            if (opts.sudo) args.push("-u", "root");
            const child = spawn("sbx", [...args, name, "sh", "-c", command], {
              env: { ...process.env, ...env },
            });
            child.stdout.setEncoding("utf8");
            child.stderr.setEncoding("utf8");
            let stdout = "";
            let stderr = "";
            let partial = "";
            child.stdout.on("data", (text: string) => {
              stdout += text;
              const lines = (partial + text).split("\n");
              partial = lines.pop()!;
              for (const line of lines) opts.onLine?.(line);
            });
            child.stderr.on("data", (text: string) => (stderr += text));
            child.on("error", reject);
            child.on("close", (code) => {
              if (partial) opts.onLine?.(partial);
              // opencode --format json reports its fatal error on stdout ({"type":"error"}), and
              // Sandcastle's AgentError shows only stderr. Copy the message over so it's visible.
              if (code !== 0) {
                for (const line of stdout.split("\n").filter((l) => l.includes('"type":"error"'))) {
                  try { stderr += `\n${JSON.parse(line).error?.message ?? line}`; } catch {}
                }
              }
              resolve({ stdout, stderr, exitCode: code ?? 1 });
            });
            // sbx exec forwards stdin. Ending it is the provider's "</dev/null":
            // opencode run would otherwise wait for EOF.
            child.stdin.end(opts.stdin ?? "");
          }),
        copyIn: async (hostPath, sandboxPath) => {
          sbx(["cp", hostPath, `${name}:${sandboxPath}`]);
        },
        copyFileOut: async (sandboxPath, hostPath) => {
          sbx(["cp", `${name}:${sandboxPath}`, hostPath]);
        },
        close: async () => {
          process.off("exit", removeOnExit);
          process.off("SIGINT", onSignal);
          process.off("SIGTERM", onSignal);
          sbx(["rm", "--force", name]);
        },
      };
    },
  });
}

// A failed run() syncs nothing to the host, but the VM still has the work until close().
// Call this BEFORE close(): it stops the agent, commits any uncommitted work as one WIP
// commit, and fetches everything since `base` into the host ref `ref`.
// Returns how many commits were saved (0 = nothing to save).
export function salvage(sandboxId: string, base: string, ref: string): number {
  const vm = (command: string) => sbx(["exec", "-w", WORKSPACE, sandboxId, "sh", "-c", command]);
  // The agent may still be running: Sandcastle stops waiting on a timeout, it doesn't kill it.
  vm("pkill -f 'opencode [r]un'; sleep 1; git add -A && git -c commit.gpgsign=false commit -qm 'WIP: salvaged after a failed run' || true");
  const count = Number(vm(`git rev-list --count ${base}..HEAD`));
  if (!count) return 0;
  vm(`git bundle create -q /tmp/salvage.bundle HEAD ^${base}`);
  mkdirSync(".sandcastle/salvage", { recursive: true });
  const file = `.sandcastle/salvage/${ref.split("/").pop()}.bundle`;
  sbx(["cp", `${sandboxId}:/tmp/salvage.bundle`, file]);
  execFileSync("git", ["fetch", "-q", file, `+HEAD:${ref}`]);
  return count;
}
