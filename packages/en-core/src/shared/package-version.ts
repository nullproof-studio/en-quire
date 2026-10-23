// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Version of the package that owns `moduleUrl` (pass `import.meta.url`).
 * Walks up to the nearest package.json, so it resolves the same from
 * `src/bin.ts` under test and `dist/bin.js` once published. Used for
 * serverInfo.version so the handshake always reports the shipped release.
 */
export function readPackageVersion(moduleUrl: string | URL): string {
  let dir = dirname(fileURLToPath(moduleUrl));
  for (;;) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      const { version } = JSON.parse(readFileSync(candidate, 'utf8')) as { version?: unknown };
      if (typeof version === 'string') return version;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`No package.json with a version found above ${fileURLToPath(moduleUrl)}`);
    }
    dir = parent;
  }
}
