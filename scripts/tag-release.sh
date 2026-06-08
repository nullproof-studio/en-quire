#!/usr/bin/env bash
#
# tag-release.sh — tag a merged release commit to trigger publishing.
#
# Run on main AFTER a `chore(release): vX.Y.Z` PR (from scripts/release.sh) has
# merged. It reads the version from the packages, verifies all three agree,
# creates the annotated tag on the current commit, and pushes it. Pushing the
# tag fires .github/workflows/release.yml, which publishes to npm (OIDC trusted
# publishing + provenance) and cuts the GitHub Release.
#
# Tags are not branch-protected, so this needs no PR.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# --- preconditions: clean main, in sync with origin ---
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo "error: run from 'main' (on '$branch')." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty." >&2
  exit 1
fi
git fetch origin main --quiet
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "error: local main is not in sync with origin/main — run 'git pull' first." >&2
  exit 1
fi

# --- read version and verify lockstep ---
NEW="$(node -p "require('./packages/en-core/package.json').version")"
for pkg in en-quire en-scribe; do
  V="$(node -p "require('./packages/$pkg/package.json').version")"
  if [ "$V" != "$NEW" ]; then
    echo "error: $pkg is $V but en-core is $NEW — versions are not in lockstep." >&2
    exit 1
  fi
done

if git rev-parse "v$NEW" >/dev/null 2>&1; then
  echo "error: tag v$NEW already exists. Has this version already been released?" >&2
  exit 1
fi

# --- tag + push ---
git tag -a "v$NEW" -m "en-quire v$NEW"
git push origin "v$NEW"

echo
echo "✓ Pushed tag v$NEW — the Release workflow will publish to npm and cut the GitHub Release."
echo "  Watch it:  gh run watch \$(gh run list --workflow=release.yml -L1 --json databaseId -q '.[0].databaseId')"
