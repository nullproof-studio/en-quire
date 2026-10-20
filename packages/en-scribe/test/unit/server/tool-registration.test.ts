// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ToolRegistry } from '@nullproof-studio/en-core';
import { registerEnScribeTools } from '../../../src/plugin.js';

/**
 * Ensures every exported tool handler in src/tools/ is registered via
 * registerEnScribeTools(). Mirrors the equivalent guard in en-quire.
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

  const infrastructure = new Set<string>();

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
  registerEnScribeTools(registry);
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
        'Add a registry.register() call for each handler in registerEnScribeTools().',
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

/**
 * Mirrors the en-quire annotation guard: every tool declares all four hints,
 * describing the worst case (write mode). A new tool must be added here.
 */
describe('tool annotations', () => {
  const R = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const ADD = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  const SAFE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const OVER = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

  const expected: Record<string, typeof R> = {
    text_read: R,
    text_find: R,
    text_head: R,
    text_tail: R,
    text_list: R,
    text_status: R,
    text_proposals_list: R,
    text_proposal_diff: R,
    text_append: ADD,
    text_insert_at_anchor: ADD,
    text_create: SAFE,
    text_rename: SAFE,
    text_replace_range: OVER,
    text_edit: OVER,
    text_delete: OVER,
    text_proposal_approve: OVER,
    text_proposal_reject: OVER,
  };

  const registry = new ToolRegistry();
  registerEnScribeTools(registry);
  const tools = registry.all();

  it('lists every registered tool', () => {
    expect(tools.map(t => t.name).sort()).toEqual(Object.keys(expected).sort());
  });

  it.each(Object.entries(expected))('%s declares the expected annotations', (name, hints) => {
    expect(tools.find(t => t.name === name)?.annotations).toEqual(hints);
  });
});
