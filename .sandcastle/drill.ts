// One unannounced fault per round, on the same provider the loop uses.
//   npm --prefix .sandcastle run drill                    a random fault you haven't seen yet
//   npm --prefix .sandcastle run drill -- --fault <id>    replay one
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { run, opencode } from "@ai-hero/sandcastle";
import { project } from "./project.ts";
import { git, preflight, sandbox } from "./shared.ts";

const BRANCH = "sandcastle/drill";
const PROMPT = ".sandcastle/logs/drill-prompt.md";
const RECORD = ".sandcastle/logs/drill.md";
const BAD_PAT_ITEM = "sandcastle-drill-bad-pat"; // created for one round, then deleted

const prompt = (extra = "") =>
  [
    "# Repository\n\n!`gh api 'repos/{owner}/{repo}' --jq .full_name`\n\n!`git log --oneline -3`",
    extra,
    "# Task\n\nReply with the repository name above, then end with exactly: <promise>DONE</promise>",
  ].join("\n\n");

// A Copilot credential in the right shape, holding tokens GitHub never issued.
const revoked = () => {
  const cred = JSON.parse(execFileSync("opencode", ["auth", "export", "github-copilot"], { encoding: "utf8" }));
  for (const c of cred) c.value.access = c.value.refresh = `gho_${randomBytes(18).toString("hex")}`;
  return JSON.stringify(cred);
};

type Fault = {
  name: string;
  provider?: Parameters<typeof sandbox>[0];
  model?: string;
  extra?: string;
  before?: () => void;
  after?: () => void;
  tell: string;
  fix: string;
};

const FAULTS: Record<string, Fault> = {
  healthy: {
    name: "Nothing is broken",
    tell: "DONE, the right repository name, and only the expected expansion lines in the log.",
    fix: "None. Calling a healthy run broken costs as much time as missing a real fault.",
  },
  "copilot-revoked": {
    name: "Copilot credential revoked or expired",
    provider: { copilotAuth: revoked() },
    tell: "AgentError: Provider request failed with HTTP 401: unauthorized, after \"Agent started\". Expansion ran gh fine, so the PAT is OK; only the model call was refused.",
    fix: "On the Mac: opencode auth login (choose GitHub Copilot). The provider exports a fresh copy at every create, so nothing else changes.",
  },
  "copilot-missing": {
    name: "Copilot credential never reached the VM",
    provider: { copilotAuth: null },
    tell: "AgentError: Model unavailable, naming a model that exists (it's in opencode models github-copilot): opencode in the VM has no github-copilot login at all.",
    fix: "Check the source on the Mac: opencode auth export github-copilot | wc -c (0 = log in again). Then check the import step in sbx-isolated.ts.",
  },
  "model-typo": {
    name: "Model id wrong or withdrawn",
    model: "github-copilot/claude-haiku-5",
    tell: "\"Model unavailable\" naming an id that isn't in opencode models github-copilot. Same message as a missing login; the id tells them apart.",
    fix: "Copy the exact id from opencode models github-copilot into project.ts.",
  },
  "pat-bad": {
    name: "GitHub PAT expired or wrong",
    provider: { ghKeychainItem: BAD_PAT_ITEM },
    before: () => execFileSync("security", ["add-generic-password", "-U", "-a", process.env.USER!, "-s", BAD_PAT_ITEM, "-w", `github_pat_${randomBytes(30).toString("hex")}`]),
    after: () => execFileSync("security", ["delete-generic-password", "-s", BAD_PAT_ITEM], { stdio: "ignore" }),
    tell: "PromptError: gh api repos/{owner}/{repo} … HTTP 401: Bad credentials. The VM was created, so the Keychain item exists; its value is wrong. The agent never started.",
    fix: "Make a new fine-grained PAT, then: security add-generic-password -U -a \"$USER\" -s <ghKeychainItem from project.ts> -w",
  },
  "keychain-missing": {
    name: "The PAT's Keychain item doesn't exist",
    provider: { ghKeychainItem: "sandcastle-drill-no-such-item" },
    tell: "verify command failed … exit status 44, from sbx secret set-custom, before any VM exists. 44 is security's \"item not found\".",
    fix: "security find-generic-password -s <ghKeychainItem> (check the name in project.ts), or create it with security add-generic-password -a \"$USER\" -s <item> -w",
  },
  "no-repo": {
    name: "gh doesn't know which repo (GH_REPO missing)",
    provider: { env: {} },
    tell: "PromptError from gh that isn't a 401: none of the git remotes is a known GitHub host. The VM's clone came from a bundle, not from GitHub.",
    fix: "Set repo in project.ts; shared.ts passes it to the VM as GH_REPO.",
  },
  "stale-env": {
    name: "A real GH_TOKEN reached the provider's env",
    provider: { env: { GH_REPO: project.repo, GH_TOKEN: `github_pat_${randomBytes(30).toString("hex")}` } },
    tell: "sbxIsolated: GH_TOKEN must not be set, before sbx is called. In real life: an old .sandcastle/.env lists GH_TOKEN and the shell exports it (with-secrets.sh).",
    fix: "rm .sandcastle/.env (or drop GH_TOKEN from it), and stop wrapping runs in with-secrets.sh.",
  },
  argv: {
    name: "Expanded prompt over the argv limit",
    extra: "# Recent history\n\n!`git log -p -n 80`",
    tell: "ExecError: spawn E2BIG, right after expansion (one expansion line is huge in the log). The Mac refused to start sbx exec: the whole prompt is one argument, and macOS caps arguments + env at 1 MiB (sysctl kern.argmax).",
    fix: "opencode() passes the whole prompt as one argument (#968). Let the agent fetch big inputs itself instead of !`…` expansion.",
  },
};

const args = process.argv.slice(2);
const seen = existsSync(RECORD) ? [...readFileSync(RECORD, "utf8").matchAll(/^- fault: (\S+)/gm)].map((m) => m[1]) : [];
const unseen = Object.keys(FAULTS).filter((id) => !seen.includes(id));
const pool = unseen.length ? unseen : Object.keys(FAULTS);
const id = args.includes("--fault") ? args[args.indexOf("--fault") + 1] : pool[Math.floor(Math.random() * pool.length)];
const fault = FAULTS[id];
if (!fault) throw new Error(`unknown fault "${id}", use one of: ${Object.keys(FAULTS).join(", ")}`);

preflight();
const deleteBranch = () => { try { execFileSync("git", ["branch", "-D", BRANCH], { stdio: "ignore" }); } catch {} };
deleteBranch();
mkdirSync(".sandcastle/logs", { recursive: true });
writeFileSync(PROMPT, prompt(fault.extra));

console.log(`Drill round ${seen.length + 1}. Something may or may not be broken.\n`);
const start = Date.now();
let output: string;
try {
  fault.before?.();
  const r = await run({
    name: "drill",
    agent: opencode(fault.model ?? project.models.cheap),
    sandbox: sandbox(fault.provider),
    branchStrategy: { type: "branch", branch: BRANCH },
    promptFile: PROMPT,
    completionSignal: "<promise>DONE</promise>",
  });
  output = `signal: ${r.completionSignal ?? "none"}\n${r.stdout.trim().split("\n").slice(-3).join("\n")}\nlog: ${r.logFilePath}`;
} catch (error) {
  output = String(error).split("\n").filter((l) => !/^\s+at /.test(l)).join("\n").slice(0, 1500);
} finally {
  try { fault.after?.(); } catch {}
}
deleteBranch();
console.log(`\n--- result after ${Math.round((Date.now() - start) / 1000)} s ---\n${output}\n`);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
const ask = async (q: string) => {
  process.stdout.write(q);
  return String((await lines.next()).value ?? "").trim();
};
console.log("Diagnose it from this output and the log. No cheat sheet.");
const origin = await ask("Which credential or setting is at fault, and where does it originate? ");
const fix = await ask("The fix, as a command (or the file and line): ");
const menu = Object.entries(FAULTS).sort(([, a], [, b]) => a.name.localeCompare(b.name));
menu.forEach(([, f], i) => console.log(`  ${String.fromCharCode(97 + i)}. ${f.name}`));
const pick = menu[(await ask("Which one was it? ")).toLowerCase().charCodeAt(0) - 97]?.[0];
rl.close();

console.log(`\n${pick === id ? "Right" : "WRONG"}: it was "${fault.name}".`);
console.log(`The tell: ${fault.tell}`);
console.log(`The fix:  ${fault.fix}`);
appendFileSync(
  RECORD,
  `\n## Round ${seen.length + 1}, ${new Date().toISOString()} (${git("rev-parse", "--short", "HEAD")})\n- fault: ${id}\n- picked: ${pick ?? "?"} (${pick === id ? "right" : "wrong"})\n- origin: ${origin}\n- fix: ${fix}\n`,
);
