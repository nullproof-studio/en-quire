// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// bin.ts starts the server on import, so check the source: serverInfo.version
// must come from package.json, never a literal that drifts between releases.
describe('serverInfo.version', () => {
  const bin = readFileSync(join(__dirname, '../../../src/bin.ts'), 'utf8');

  it('is read from package.json', () => {
    expect(bin).toMatch(/version: readPackageVersion\(import\.meta\.url\)/);
  });

  it('is not hardcoded', () => {
    expect(bin).not.toMatch(/version: '\d+\.\d+\.\d+'/);
  });
});
