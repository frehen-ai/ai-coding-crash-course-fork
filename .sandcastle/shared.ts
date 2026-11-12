import { execFileSync } from "node:child_process";
import { createSandbox } from "@ai-hero/sandcastle";
import { project } from "./project.ts";
import { sbxIsolated } from "./sbx-isolated.ts";
import { READY, TAKEN, REVIEW, STOPPED } from "./plan.ts";

export const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
export const signal = (s?: string) => s?.match(/<promise>(\w+)<\/promise>/)?.[1] ?? "NO SIGNAL";

// gh on the Mac uses the same PAT as the VM, read from the Keychain for each call. It goes
// into the child's env only, never into process.env (sbxIsolated refuses a GH_TOKEN there).
const pat = () => execFileSync("security", ["find-generic-password", "-s", project.ghKeychainItem, "-w"], { encoding: "utf8" }).trim();
export const gh = (...args: string[]) =>
  execFileSync("gh", args, { encoding: "utf8", env: { ...process.env, GH_TOKEN: pat(), GH_REPO: project.repo } }).trim();

export const sandbox = (overrides: Partial<Parameters<typeof sbxIsolated>[0]> = {}) =>
  sbxIsolated({
    stack: project.stack,
    name: project.name,
    ghKeychainItem: project.ghKeychainItem,
    env: { GH_REPO: project.repo }, // the VM's clone has no GitHub remote
    ...overrides,
  });

// Things that would otherwise fail late, or silently.
export function preflight() {
  // Commits come back through "git am" on the Mac, which signs them if you sign.
  let signs = "";
  try { signs = git("config", "commit.gpgsign"); } catch {}
  if (signs === "true") {
    try { execFileSync("ssh-add", ["-l"], { stdio: "ignore" }); } catch {
      throw new Error("ssh-agent has no key, so git am can't sign. Run: ssh-add --apple-use-keychain ~/.ssh/id_ed25519");
    }
  }
}

export function ensureLabels() {
  const have = gh("label", "list", "--limit", "200", "--json", "name", "--jq", ".[].name").split("\n");
  for (const label of [READY, TAKEN, REVIEW, STOPPED]) if (!have.includes(label)) gh("label", "create", label);
}

// createSandbox() still ignores sandbox hook exit codes and timeoutMs in 0.14.0 (only run()
// checks them). So setup runs as plain exec() calls, and a non-zero exit throws here.
export async function openSandbox(branch: string, baseBranch: string, overrides = {}) {
  const sb = await createSandbox({ branch, baseBranch, sandbox: sandbox(overrides) });
  try {
    for (const command of project.setup) {
      const r = await sb.exec(command);
      if (r.exitCode !== 0) throw new Error(`setup "${command}" exited ${r.exitCode}:\n${(r.stderr || r.stdout).slice(-1500)}`);
    }
  } catch (error) {
    await sb.close();
    throw error;
  }
  return sb;
}
