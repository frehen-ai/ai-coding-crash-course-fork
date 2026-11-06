#!/bin/sh
# Fetches the secrets for this run only. Nothing is stored in the repo.
set -eu

# Load ssh secret used for git 
ssh-add -l >/dev/null 2>&1 || ssh-add --apple-load-keychain 2>/dev/null
ssh-add -l >/dev/null || { echo "ssh agent has no key; commit signing would block the sync. Run: ssh-add --apple-use-keychain ~/.ssh/id_ed25519" >&2; exit 1; }

OPENCODE_AUTH_B64="$(opencode auth export github-copilot | base64)"
GH_TOKEN="$(security find-generic-password -s gh-frehen-ai-ai-coding-crash-course-fork -w)"
export OPENCODE_AUTH_B64 GH_TOKEN
exec "$@"
