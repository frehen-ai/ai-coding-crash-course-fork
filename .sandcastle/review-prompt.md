# Review of issue #{{ISSUE}}

!`gh issue view {{ISSUE}} --json number,title,body --jq '{number, title, body}'`

# Commits to review

!`git log --format='%h %s%n%b' {{BASE}}..HEAD`

!`git diff --stat {{BASE}}...HEAD`

# Task

You are reviewing another agent's implementation of issue #{{ISSUE}} on branch `{{SOURCE_BRANCH}}`. Nobody is watching this session.

1. Read the parent PRD named under "Parent" with `gh issue view <number>`.
2. Call the skill tool with id `code-review`. The fixed point is `{{BASE}}`, and the spec is the issue above plus its parent PRD.
3. Fix every finding that is a real defect or a gap against the spec, with a test whenever behaviour changes. Leave matters of taste alone.
4. If you changed anything, run `{{CHECK}}`, then commit once. The message starts with `#{{ISSUE}}: review fixes` and lists each finding and what you did about it.

# Rules

- Review only the changes in `{{BASE}}...HEAD`.
- Don't read issue comments, and don't look at other branches, tags or commits outside `git log HEAD`.
- Never ask questions. Do NOT close, label or comment on the issue.
- Add a new commit. Never amend, rebase or reset.

# Outcome

End your final message with exactly one of the two lines below. Never write either line anywhere else.
Write the first if you committed nothing:

<promise>APPROVED</promise>

Write the second if you committed fixes and `{{CHECK}}` passes:

<promise>FIXED</promise>
