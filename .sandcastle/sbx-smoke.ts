// Known positive for sbxIsolated(): one run() commits inside a fresh sbx VM,
// and the commit must arrive on a host branch. Exits 1 if it doesn't.
import { execFileSync } from "node:child_process";
import { run, opencode } from "@ai-hero/sandcastle";
import { sbxIsolated } from "./sbx-isolated.ts";

const branch = "sandcastle/sbx-smoke";
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const before = git("rev-parse", "HEAD");
// Start clean: an interrupted run leaves its worktree (and branch) behind.
for (const args of [["worktree", "remove", "--force", ".sandcastle/worktrees/sandcastle-sbx-smoke"], ["branch", "-D", branch]]) {
  try { execFileSync("git", args, { stdio: "ignore" }); } catch {}
}

await run({
  name: "sbx-smoke",
  agent: opencode("github-copilot/claude-haiku-5.5"),
  sandbox: sbxIsolated({
    stack: "node",
    name: "loop-crash-fork",
    ghKeychainItem: "gh-frehen-ai-ai-coding-crash-course-fork",
  }),
  branchStrategy: { type: "branch", branch },
  hooks: {
    sandbox: {
      // Setup gate (0.14 fails run() on a non-zero hook): gh is authenticated, the VM has dockerd.
      onSandboxReady: [{ command: "gh api user --jq .login && docker info --format '{{.OperatingSystem}}'" }],
    },
  },
  prompt: process.env.HOLD
    ? "Run this exact shell command and nothing else: sleep 90" // time to look inside, then Ctrl-C
    : "Run this exact shell command and nothing else, then reply DONE:\n" +
      "echo \"smoke $(date -u +%FT%TZ)\" > SBX_SMOKE.md && git add SBX_SMOKE.md && git commit -m 'chore: sbx smoke'",
  completionSignal: "DONE",
});

const subject = git("log", "-1", "--format=%s", branch);
const parent = git("rev-parse", `${branch}~1`);
if (subject !== "chore: sbx smoke" || parent !== before) {
  console.error(`FAIL: ${branch} has "${subject}" on ${parent.slice(0, 7)}, expected "chore: sbx smoke" on ${before.slice(0, 7)}`);
  process.exit(1);
}
console.log(`OK: ${branch} = ${git("rev-parse", "--short", branch)} "${subject}"`);
