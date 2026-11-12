# Issue #{{ISSUE}}

!`gh issue view {{ISSUE}} --json number,title,state,body --jq '{number, title, state, body}'`

# Repository state

Starting commit: !`git rev-parse --short HEAD`

!`git status --short`

!`git log --oneline -8`

# Task

You are implementing issue #{{ISSUE}} on branch `{{SOURCE_BRANCH}}`. Nobody is watching this session.

1. If the repository state shows uncommitted changes, a previous attempt was interrupted. Inspect them with `git diff`, then finish or discard them first.
2. Read the parent PRD named under "Parent" with `gh issue view <number>`.
3. Call the skill tool with id `implement` and follow it for this one issue, test first. The issue and its parent PRD are the spec. Use the starting commit as the fixed point for `/code-review`.
4. The commit message starts with `#{{ISSUE}}: ` and lists key decisions, files changed, and anything a reviewer should check.

# Rules

- Implement only issue #{{ISSUE}}.
- Write the code yourself. Don't read issue comments, and don't look at other branches, tags or commits outside `git log HEAD`.
- Never ask questions or offer options. Decide, and record the decision in the commit message.
- Do NOT close the issue or change its labels. The loop does that.
- `{{CHECK}}` must pass before you commit.

# Outcome

End your final message with exactly one of the two lines below. Never write either line anywhere else.
Write the first if you committed and `{{CHECK}}` passes:

<promise>DONE</promise>

Write the second if you could not finish, after explaining why with `gh issue comment {{ISSUE}} --body "..."`:

<promise>BLOCKED</promise>
