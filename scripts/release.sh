#!/usr/bin/env bash
#
# release.sh — bump all three packages in lockstep, commit, and tag.
#
# Usage:
#   scripts/release.sh <patch|minor|major|X.Y.Z> [--skip-tests]
#
# Examples:
#   scripts/release.sh minor        # 0.2.0 -> 0.3.0
#   scripts/release.sh 0.2.1        # explicit version
#
# What it does (nothing is pushed — that's the last manual step):
#   1. Refuses to run on a dirty tree or off the main branch.
#   2. Bumps version in en-core, en-quire, en-scribe to the SAME version, and
#      updates the @nullproof-studio/en-core dependency pin in en-quire/en-scribe.
#   3. Syncs package-lock.json, builds, and runs tests (skip with --skip-tests).
#   4. Commits "chore(release): vX.Y.Z" and creates the matching tag.
#
# Then push to fire the Release workflow:
#   git push origin main --follow-tags

set -euo pipefail

PACKAGES=(en-core en-quire en-scribe)
DEPENDENTS=(en-quire en-scribe)   # packages that pin @nullproof-studio/en-core
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --- args ---
BUMP="${1:-}"
SKIP_TESTS=0
for a in "${@:2}"; do
  [ "$a" = "--skip-tests" ] && SKIP_TESTS=1
done
if [ -z "$BUMP" ]; then
  echo "usage: scripts/release.sh <patch|minor|major|X.Y.Z> [--skip-tests]" >&2
  exit 1
fi

# --- preconditions ---
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo "error: releases must be cut from 'main' (on '$branch')." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty — commit or stash first." >&2
  exit 1
fi

# --- compute the new version once, from en-core ---
NEW="$(cd packages/en-core && npm version "$BUMP" --no-git-tag-version)"
NEW="${NEW#v}"
echo "Releasing v$NEW"

# --- apply to the other packages + dependency pins ---
for pkg in "${PACKAGES[@]:1}"; do
  npm version "$NEW" --no-git-tag-version -w "@nullproof-studio/$pkg" >/dev/null
done
for pkg in "${DEPENDENTS[@]}"; do
  npm pkg set "dependencies.@nullproof-studio/en-core=$NEW" -w "@nullproof-studio/$pkg"
done

# --- sync lockfile, build, test ---
npm install --package-lock-only
npm run build
if [ "$SKIP_TESTS" = 0 ]; then
  npm test
else
  echo "⚠️  tests skipped (--skip-tests)"
fi

# --- commit + tag ---
git add packages/*/package.json package-lock.json
git commit -m "chore(release): v$NEW"
git tag -a "v$NEW" -m "en-quire v$NEW"

echo
echo "✓ Committed and tagged v$NEW. To release, push:"
echo "    git push origin main --follow-tags"
