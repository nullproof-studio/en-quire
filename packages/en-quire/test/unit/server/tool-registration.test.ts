// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ToolRegistry } from '@nullproof-studio/en-core';
import { registerEnQuireTools } from '../../../src/plugin.js';

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
  const infrastructure = new Set(['write-helpers.ts']);

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

/**
 * Clients use MCP tool annotations to decide which calls need user approval,
 * so every tool declares all four hints. Hints describe the worst case (write
 * mode); a write in propose mode is gentler than its hints say.
 * A new tool must be added here deliberately.
 */
describe('tool annotations', () => {
  const R = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  // Adds content; repeating the call adds it again.
  const ADD = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  // Changes without losing content; repeating it changes nothing more (or fails).
  const SAFE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  // Overwrites or removes content; repeating it changes nothing more (or fails).
  const OVER = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
  // Overwrites or removes content; repeating it may change more.
  const DESTROY = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
  // Fetches https sources; records citations (deduped unless force).
  const CITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

  const expected: Record<string, typeof R> = {
    doc_outline: R,
    doc_read_section: R,
    doc_read: R,
    doc_list: R,
    doc_references: R,
    doc_referenced_by: R,
    doc_context_bundle: R,
    doc_history: R,
    doc_table_read: R,
    doc_status: R,
    doc_search: R,
    doc_proposals_list: R,
    doc_proposal_diff: R,
    doc_append_section: ADD,
    doc_insert_section: ADD,
    doc_insert_text: ADD,
    doc_create: SAFE,
    doc_rename: SAFE,
    doc_rename_section: SAFE,
    doc_move_section: SAFE,
    doc_generate_toc: SAFE,
    doc_assign_ids: SAFE,
    doc_replace_section: OVER,
    doc_set_value: OVER,
    doc_delete_section: OVER,
    doc_proposal_approve: OVER,
    doc_proposal_reject: OVER,
    doc_find_replace: DESTROY,
    doc_table_write: DESTROY,
    doc_cite: CITE,
    doc_cite_reverify: CITE,
  };

  const registry = new ToolRegistry();
  registerEnQuireTools(registry);
  const tools = registry.all();

  it('lists every registered tool', () => {
    expect(tools.map(t => t.name).sort()).toEqual(Object.keys(expected).sort());
  });

  it.each(Object.entries(expected))('%s declares the expected annotations', (name, hints) => {
    expect(tools.find(t => t.name === name)?.annotations).toEqual(hints);
  });
});
