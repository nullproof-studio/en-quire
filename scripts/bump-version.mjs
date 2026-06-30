#!/usr/bin/env node
// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
//
// Lockstep version bumper for the en-quire monorepo. All publishable packages
// (en-core, en-quire, en-scribe) share one version, and the internal
// `@nullproof-studio/*` dependency pins are kept exactly in sync so a release
// never ships en-quire pointing at a stale en-core. Usage:
//
//   node scripts/bump-version.mjs <major|minor|patch|X.Y.Z>
//
// Rewrites the three package.json files, refreshes package-lock.json, prints
// the new version, and (in CI) appends `version=<new>` to $GITHUB_OUTPUT.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PACKAGES = ['en-core', 'en-quire', 'en-scribe'].map((p) => `packages/${p}/package.json`);
const SOURCE_OF_TRUTH = 'packages/en-core/package.json';
const INTERNAL_SCOPE = '@nullproof-studio/';
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, obj) => writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`Unsupported version "${v}" — expected plain X.Y.Z`);
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function nextVersion(current, arg) {
  if (/^\d+\.\d+\.\d+$/.test(arg)) return arg; // explicit version wins
  const { major, minor, patch } = parseSemver(current);
  switch (arg) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unknown bump "${arg}" — use major | minor | patch | X.Y.Z`);
  }
}

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node scripts/bump-version.mjs <major|minor|patch|X.Y.Z>');
  process.exit(1);
}

const current = readJson(SOURCE_OF_TRUTH).version;
const next = nextVersion(current, arg);
if (next === current) {
  console.error(`Refusing to bump: version is already ${next}`);
  process.exit(1);
}

for (const path of PACKAGES) {
  const pkg = readJson(path);
  pkg.version = next;
  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (name.startsWith(INTERNAL_SCOPE)) deps[name] = next; // exact lockstep pin
    }
  }
  writeJson(path, pkg);
}

// Sync the lockfile's recorded versions without touching node_modules.
execFileSync('npm', ['install', '--package-lock-only'], { stdio: 'inherit' });

console.log(`Bumped ${current} -> ${next}`);
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${next}\n`);
}
