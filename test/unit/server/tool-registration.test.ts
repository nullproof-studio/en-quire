// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ensures every exported tool handler in src/tools/ has a corresponding
 * server.tool() registration in src/server.ts.
 *
 * Prevents the class of bug where a tool is fully implemented (source,
 * schema, handler, tests) but never wired into the MCP server.
 * See: https://github.com/nullproof-studio/en-quire/issues/46
 */

function collectFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectFiles(full, ext));
    } else if (full.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

describe('tool registration', () => {
  const toolsDir = join(__dirname, '../../../src/tools');
  const serverPath = join(__dirname, '../../../src/server.ts');
  const serverContent = readFileSync(serverPath, 'utf8');

  // Extract all handler names from src/tools/**/*.ts
  const toolFiles = collectFiles(toolsDir, '.ts')
    .filter(f => !f.endsWith('context.ts') && !f.endsWith('write-helpers.ts'));

  const handlers: { name: string; file: string }[] = [];
  for (const file of toolFiles) {
    const content = readFileSync(file, 'utf8');
    const matches = content.matchAll(/export async function (handle\w+)/g);
    for (const m of matches) {
      handlers.push({ name: m[1], file: file.replace(/.*src\/tools\//, 'src/tools/') });
    }
  }

  // Extract all registered handler names from server.ts
  const registrations = [...serverContent.matchAll(/wrapHandler\(?'[^']+',\s*(\w+)\)/g)]
    .map(m => m[1]);

  it('should have at least one handler to test', () => {
    expect(handlers.length).toBeGreaterThan(0);
  });

  it('should register every exported tool handler in server.ts', () => {
    const unregistered = handlers.filter(h => !registrations.includes(h.name));
    if (unregistered.length > 0) {
      const details = unregistered
        .map(h => `  ${h.name} (${h.file})`)
        .join('\n');
      throw new Error(
        `${unregistered.length} tool handler(s) exported but not registered in server.ts:\n${details}\n\n` +
        'Add a server.tool() call for each handler in src/server.ts.',
      );
    }
  });

  it('should not register handlers that do not exist', () => {
    const handlerNames = handlers.map(h => h.name);
    const stale = registrations.filter(r => !handlerNames.includes(r));
    if (stale.length > 0) {
      throw new Error(
        `${stale.length} registration(s) in server.ts reference non-existent handlers:\n` +
        stale.map(s => `  ${s}`).join('\n'),
      );
    }
  });

  it('should import every registered handler', () => {
    for (const reg of registrations) {
      expect(serverContent).toContain(`import { `);
      expect(serverContent).toContain(reg);
    }
  });
});
