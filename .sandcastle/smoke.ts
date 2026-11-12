// Known positive for the whole setup: VM, setup commands, gh + GH_REPO, dockerd, agent,
// and the way back to the host.
//   npm --prefix .sandcastle run smoke              a commit made in the VM must land on sandcastle/smoke
//   FAIL=1 npm --prefix .sandcastle run smoke       the run fails after the commit: the branch must stay
//                                                    empty, and salvage() must save the commit
import { execFileSync } from "node:child_process";
import { opencode } from "@ai-hero/sandcastle";
import { project } from "./project.ts";
import { git, preflight, openSandbox } from "./shared.ts";
import { salvage } from "./sbx-isolated.ts";

const fail = !!process.env.FAIL;
const branch = "sandcastle/smoke";
const ref = "refs/salvage/smoke";
const quiet = (...args: string[]) => { try { execFileSync("git", args, { stdio: "ignore" }); } catch {} };

preflight();
// Start clean: an interrupted run leaves its worktree (and branch) behind.
quiet("worktree", "remove", "--force", ".sandcastle/worktrees/sandcastle-smoke");
quiet("branch", "-D", branch);
quiet("update-ref", "-d", ref);
const from = git("branch", "--show-current");
const before = git("rev-parse", "HEAD");

const sb = await openSandbox(branch, from);
let error: unknown;
try {
  const gate = await sb.exec("gh api 'repos/{owner}/{repo}' --jq .full_name && docker info --format '{{.OperatingSystem}}'");
  console.log(gate.stdout.trim());
  if (gate.exitCode !== 0) throw new Error(`gate failed: ${gate.stderr}`);
  await sb.run({
    name: "smoke",
    agent: opencode(project.models.cheap),
    prompt:
      "Run this exact shell command and nothing else, then reply DONE:\n" +
      "echo \"smoke $(date -u +%FT%TZ)\" > SBX_SMOKE.md && git add SBX_SMOKE.md && git commit -m 'chore: sbx smoke'" +
      (fail ? " && sleep 60" : ""),
    completionSignal: "DONE",
    idleTimeoutSeconds: fail ? 20 : undefined,
  });
} catch (e) {
  error = e;
  console.log(`run failed: ${String(e).split("\n")[0]}`);
  console.log(`salvaged: ${salvage(sb.sandboxId!, before, ref)} commit(s)`);
} finally {
  await sb.close();
}

const onBranch = Number(git("rev-list", "--count", `${before}..${branch}`));
const subject = (rev: string) => { try { return git("log", "-1", "--format=%s", rev); } catch { return "(none)"; } };
const ok = fail
  ? !!error && onBranch === 0 && subject(ref) === "chore: sbx smoke"
  : !error && onBranch === 1 && subject(branch) === "chore: sbx smoke";
console.log(`${branch}: ${onBranch} new commit(s)${fail ? `; ${ref}: "${subject(ref)}"` : ""}`);
console.log(ok ? "OK" : "FAIL");
process.exit(ok ? 0 : 1);
