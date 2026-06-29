#!/usr/bin/env bash
#
# release.sh — prepare a lockstep release PR.
#
# Usage:
#   scripts/release.sh <patch|minor|major|X.Y.Z>
#
# main is protected (PRs + status checks required), so releases go through a PR:
#   1. This script bumps en-core, en-quire, en-scribe to the SAME version (plus
#      the @nullproof-studio/en-core dependency pin in en-quire/en-scribe) on a
#      release/vX.Y.Z branch, and opens a PR.
#   2. CI validates the PR; you merge it.
#   3. On main, run scripts/tag-release.sh to tag the merged commit, which fires
#      the Release workflow (npm publish + provenance + GitHub Release).
#
# Version bumps are applied with `npm pkg set` (which never touches the
# dependency tree) and the lockfile's workspace entries are patched surgically.
# We deliberately do NOT run `npm version` or `npm install` here: those reify the
# whole workspace and re-resolve transitive optional deps (e.g. @emnapi) for the
# current platform, producing a lockfile that fails `npm ci` on Linux CI.

set -euo pipefail

PACKAGES=(en-core en-quire en-scribe)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BUMP="${1:-}"
if [ -z "$BUMP" ]; then
  echo "usage: scripts/release.sh <patch|minor|major|X.Y.Z>" >&2
  exit 1
fi

# --- preconditions: clean main, in sync with origin ---
branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  echo "error: start releases from 'main' (on '$branch')." >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty — commit or stash first." >&2
  exit 1
fi
git fetch origin main --quiet
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "error: local main differs from origin/main — run 'git pull' first." >&2
  exit 1
fi

# --- compute the new version ---
CUR="$(node -p "require('./packages/en-core/package.json').version")"
case "$BUMP" in
  patch|minor|major)
    NEW="$(node -e 'const v=process.argv[1].split(".").map(Number),t=process.argv[2];
      if(t==="major"){v[0]++;v[1]=0;v[2]=0}else if(t==="minor"){v[1]++;v[2]=0}else{v[2]++}
      console.log(v.join("."))' "$CUR" "$BUMP")"
    ;;
  *)
    if ! [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      echo "error: '$BUMP' is not a bump keyword or an X.Y.Z version." >&2
      exit 1
    fi
    NEW="$BUMP"
    ;;
esac
echo "Releasing v$NEW (from $CUR)"

# --- branch ---
git switch -c "release/v$NEW"

# --- bump package.json versions + en-core pins (no reify) ---
for pkg in "${PACKAGES[@]}"; do
  npm pkg set "version=$NEW" -w "@nullproof-studio/$pkg" >/dev/null
done
npm pkg set "dependencies.@nullproof-studio/en-core=$NEW" -w @nullproof-studio/en-quire >/dev/null
npm pkg set "dependencies.@nullproof-studio/en-core=$NEW" -w @nullproof-studio/en-scribe >/dev/null

# --- surgically patch ONLY the workspace entries in the lockfile ---
node -e '
const fs=require("fs"), f="package-lock.json", NEW=process.argv[1];
const lock=JSON.parse(fs.readFileSync(f,"utf8")), p=lock.packages;
for (const k of ["packages/en-core","packages/en-quire","packages/en-scribe"]) p[k].version=NEW;
for (const k of ["packages/en-quire","packages/en-scribe"]) p[k].dependencies["@nullproof-studio/en-core"]=NEW;
fs.writeFileSync(f, JSON.stringify(lock,null,2)+"\n");
' "$NEW"

# --- commit, push, open PR ---
git add packages/*/package.json package-lock.json
git commit -m "chore(release): v$NEW"
git push -u origin "release/v$NEW"
gh pr create --base main --head "release/v$NEW" \
  --title "chore(release): v$NEW" \
  --body "Lockstep version bump to **v$NEW** for en-core, en-quire, en-scribe (and the en-core dependency pin).

After this merges and CI is green, publish from main:
\`\`\`
git checkout main && git pull
scripts/tag-release.sh
\`\`\`"

echo
echo "✓ Opened release PR for v$NEW. Once it merges and CI is green:"
echo "    git checkout main && git pull && scripts/tag-release.sh"
