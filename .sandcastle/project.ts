// Everything project-specific lives here. install.sh copies this file to project.ts
// once and never overwrites project.ts. The other files are shared and get overwritten.
export const project = {
  repo: "frehen-ai/ai-coding-crash-course-fork", // GH_REPO for gh, on the Mac and in the VM
  name: "loop-crash-fork", // VM name prefix: loop-crash-fork-<8 hex>
  stack: "node" as const, // frehen/sbx-<stack>:stable ("node" or "jdk25")
  ghKeychainItem: "gh-frehen-ai-ai-coding-crash-course-fork", // the project's fine-grained PAT
  setup: ["npm ci --no-audit --no-fund"], // once per VM, before any agent; each must exit 0
  check: "npm run test && npm run typecheck", // must pass after every agent step
  models: {
    implement: "github-copilot/claude-opus-5.5#medium", // OpenCode v2 wants model#variant
    review: "github-copilot/gpt-6.1-sol",
    cheap: "github-copilot/claude-haiku-5.5", // smoke and drill
  },
};
