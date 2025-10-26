#!/bin/bash
# Remove .claude and CLAUDE.md from git history

git filter-branch --force --index-filter \
  'git rm --cached --ignore-unmatch -r .claude CLAUDE.md 2>/dev/null || true' \
  --prune-empty --tag-name-filter cat -- --all
