// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { readPackageVersion } from '@nullproof-studio/en-core';

// serverInfo.version once shipped as a hardcoded '0.2.0' long after the
// package moved on. Servers now read it from their own package.json.
describe('readPackageVersion', () => {
  const pkgVersion = (pkg: string) =>
    JSON.parse(readFileSync(join(__dirname, `../../../../${pkg}/package.json`), 'utf8')).version;

  it('returns the version of the package that owns the calling module', () => {
    const binUrl = pathToFileURL(join(__dirname, '../../../../en-quire/src/bin.ts')).href;
    expect(readPackageVersion(binUrl)).toBe(pkgVersion('en-quire'));
  });

  it('walks up from a nested build directory (dist/bin.js)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pkg-version-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '9.8.7' }));
    mkdirSync(join(dir, 'dist', 'nested'), { recursive: true });
    expect(readPackageVersion(pathToFileURL(join(dir, 'dist', 'nested', 'bin.js')))).toBe('9.8.7');
  });

  it('throws when no package.json with a version is found', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pkg-version-none-'));
    expect(() => readPackageVersion(pathToFileURL(join(dir, 'bin.js')))).toThrow(/package\.json/);
  });
});
