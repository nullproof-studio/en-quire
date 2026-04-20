// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ToolRegistry } from '@nullproof-studio/en-core';
import { registerEnQuireTools } from '../../../src/server.js';

/**
 * Ensures every exported tool handler in src/tools/ is registered via
 * registerEnQuireTools().
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

  // Infrastructure files that contain no tool handlers
  const infrastructure = new Set(['context.ts', 'registry.ts', 'runtime.ts', 'write-helpers.ts']);

  const toolFiles = collectFiles(toolsDir, '.ts')
    .filter(f => !infrastructure.has(f.split('/').pop()!));

  const handlers: { name: string; file: string }[] = [];
  for (const file of toolFiles) {
    const content = readFileSync(file, 'utf8');
    const matches = content.matchAll(/export async function (handle\w+)/g);
    for (const m of matches) {
      handlers.push({ name: m[1], file: file.replace(/.*src\/tools\//, 'src/tools/') });
    }
  }

  const registry = new ToolRegistry();
  registerEnQuireTools(registry);
  const registeredHandlers = new Set(
    registry.all().map(t => t.handler.name).filter(Boolean),
  );

  it('should have at least one handler to test', () => {
    expect(handlers.length).toBeGreaterThan(0);
  });

  it('should register every exported tool handler', () => {
    const unregistered = handlers.filter(h => !registeredHandlers.has(h.name));
    if (unregistered.length > 0) {
      const details = unregistered
        .map(h => `  ${h.name} (${h.file})`)
        .join('\n');
      throw new Error(
        `${unregistered.length} tool handler(s) exported but not registered:\n${details}\n\n` +
        'Add a registry.register() call for each handler in registerEnQuireTools().',
      );
    }
  });

  it('should not register handlers that do not exist', () => {
    const handlerNames = new Set(handlers.map(h => h.name));
    const stale = [...registeredHandlers].filter(r => !handlerNames.has(r));
    if (stale.length > 0) {
      throw new Error(
        `${stale.length} registration(s) reference non-existent handlers:\n` +
        stale.map(s => `  ${s}`).join('\n'),
      );
    }
  });

  it('should have no duplicate tool names', () => {
    const names = registry.all().map(t => t.name);
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
    expect(duplicates).toEqual([]);
  });
});
