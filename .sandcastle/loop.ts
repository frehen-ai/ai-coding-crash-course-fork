// The loop: implement every ready ticket, one fresh sbx VM per ticket, branches stacked.
//   npm --prefix .sandcastle run loop -- --dry-run    plan only; touches no issue
//   npm --prefix .sandcastle run loop                 run it
import { mkdirSync, writeFileSync } from "node:fs";
import { opencode } from "@ai-hero/sandcastle";
import { project } from "./project.ts";
import { plan, checkPlanner, READY, TAKEN, REVIEW, STOPPED } from "./plan.ts";
import { git, gh, signal, preflight, ensureLabels, openSandbox } from "./shared.ts";
import { salvage } from "./sbx-isolated.ts";

checkPlanner();
preflight();
const dryRun = process.argv.includes("--dry-run");

const done: number[] = []; // tickets this process finished; their branches are the stack
const ready = () =>
  plan(JSON.parse(gh("issue", "list", "--label", READY, "--state", "open", "--limit", "100", "--json", "number,body,labels,blockedBy")), done);

ensureLabels(); // creates missing labels, so even --dry-run may do that
const first = ready();
console.log(`plan: ${first.order.map((n) => `#${n}`).join(" ") || "nothing ready"}`);
for (const w of first.waiting) console.log(`  ${w}`);
for (const n of first.taken) console.log(`  #${n} skipped: ${TAKEN}`);
if (dryRun || !first.order.length) process.exit(0);
mkdirSync(".sandcastle/logs", { recursive: true });

let base = git("branch", "--show-current");
const report: string[] = [];

// Plan again before every ticket, so one taken interactively in the meantime drops out.
for (let next = first.order[0]; next; next = ready().order[0]) {
  const issue = String(next);
  const branch = `sandcastle/issue-${issue}`;
  const from = base;
  const fromSha = git("rev-parse", from);
  if (git("branch", "--list", branch) && git("rev-list", "--count", `${from}..${branch}`) !== "0") {
    report.push(`#${issue}: STOP, ${branch} already has commits. Review or delete it first`);
    break;
  }
  console.log(`\n=== #${issue}: ${branch} from ${from} ===`);
  // Claim it: interactive sessions (and other loops) skip agent-in-progress tickets.
  gh("issue", "edit", issue, "--remove-label", READY, "--add-label", TAKEN);

  let sb: Awaited<ReturnType<typeof openSandbox>> | undefined;
  let problem: string | undefined;
  let failed = false;
  let outcome = "";
  const check = async (stage: string) => {
    const result = await sb!.exec(project.check);
    if (result.exitCode !== 0) {
      console.log(result.stdout.slice(-2000));
      return `check fails after ${stage}: ${project.check}`;
    }
  };

  try {
    sb = await openSandbox(branch, from);
    // Each run() that succeeds syncs its commits to the host branch right away.
    // A run() that throws syncs nothing: that's what salvage() below is for.
    const impl = await sb.run({
      name: `implement-${issue}`,
      agent: opencode(project.models.implement),
      promptFile: ".sandcastle/implement-prompt.md",
      promptArgs: { ISSUE: issue, CHECK: project.check },
      completionSignal: ["<promise>DONE</promise>", "<promise>BLOCKED</promise>"],
    });
    console.log(`implement: ${signal(impl.completionSignal)}, ${impl.commits.length} commit(s), log ${impl.logFilePath}`);
    if (signal(impl.completionSignal) !== "DONE" || !impl.commits.length) {
      problem = `implementer: ${signal(impl.completionSignal)}, ${impl.commits.length} commit(s)`;
    } else problem = await check("implement");

    if (!problem) {
      const review = await sb.run({
        name: `review-${issue}`,
        agent: opencode(project.models.review),
        promptFile: ".sandcastle/review-prompt.md",
        promptArgs: { ISSUE: issue, BASE: fromSha, CHECK: project.check },
        completionSignal: ["<promise>APPROVED</promise>", "<promise>FIXED</promise>"],
      });
      console.log(`review: ${signal(review.completionSignal)}, ${review.commits.length} commit(s), log ${review.logFilePath}`);
      if (!review.completionSignal) problem = "reviewer gave no signal";
      else if (review.commits.length) problem = await check("review");
      if (!problem) outcome = `DONE, review ${signal(review.completionSignal)}`;
    }
  } catch (error) {
    failed = true;
    problem = String(error).slice(0, 1500);
  } finally {
    if (sb) {
      if (failed && sb.sandboxId) {
        try {
          const n = salvage(sb.sandboxId, fromSha, `refs/salvage/issue-${issue}`);
          if (n) problem += `\n${n} commit(s) from the VM saved in refs/salvage/issue-${issue}`;
        } catch (error) {
          problem += `\nsalvage failed: ${String(error).slice(0, 300)}`;
        }
      }
      const stats = await sb.exec("opencode stats --all --models --json").catch(() => undefined);
      if (stats?.exitCode === 0) {
        writeFileSync(`.sandcastle/logs/usage-${issue}.json`, stats.stdout);
        const u = JSON.parse(stats.stdout);
        console.log(`usage: ${u.prompts} prompt(s), ${u.tokens.output + u.tokens.reasoning} output tokens, ~$${u.cost.toFixed(2)} at list price`);
      }
      const { preservedWorktreePath } = await sb.close();
      if (preservedWorktreePath) problem ??= `uncommitted changes kept in ${preservedWorktreePath}`;
    }
  }

  if (problem) outcome = `STOP, ${problem}`;
  report.push(`#${issue}: ${outcome}`);
  gh("issue", "edit", issue, "--remove-label", TAKEN, "--add-label", problem ? STOPPED : REVIEW);
  gh("issue", "comment", issue, "--body", `Sandcastle loop, branch \`${branch}\` stacked on \`${from}\`:\n\n\`\`\`\n${outcome}\n\`\`\``);
  if (problem) break;
  done.push(next);
  base = branch;
}

console.log(`\n${report.join("\n")}`);
