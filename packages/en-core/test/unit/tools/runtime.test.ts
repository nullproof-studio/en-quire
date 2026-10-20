// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import {
  wrapHandler,
  MergeConflictError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
  requirePermission,
  attachRegistry,
  ToolRegistry,
  READ_ONLY,
  OVERWRITE,
} from '@nullproof-studio/en-core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import type { CallerIdentity, ToolContext } from '@nullproof-studio/en-core';

const ctx = {} as ToolContext;

async function runAndParse<T>(
  handler: (args: T, ctx: ToolContext) => Promise<unknown>,
  args: T,
): Promise<{ isError?: boolean; payload: Record<string, unknown> }> {
  const wrapped = wrapHandler<T>('test_tool', ctx, handler);
  const result = await wrapped(args);
  const text = result.content[0].text;
  return { isError: result.isError, payload: JSON.parse(text) };
}

describe('wrapHandler error serialization', () => {
  it('spreads candidates from NotFoundError into the JSON payload', async () => {
    const { isError, payload } = await runAndParse(async () => {
      throw new NotFoundError('root', 'docz/file.md', ['docs', 'dogs', 'memory'], 'Prefix the path.');
    }, {});
    expect(isError).toBe(true);
    expect(payload.error).toBe('not_found');
    expect(payload.candidates).toEqual(['docs', 'dogs', 'memory']);
    expect(payload.message).toContain('Prefix the path.');
    expect(payload.message).toContain('Did you mean: docs, dogs, memory?');
  });

  it('omits candidates when the error has none', async () => {
    const { payload } = await runAndParse(async () => {
      throw new ValidationError('bad input');
    }, {});
    expect(payload.error).toBe('validation_error');
    expect(payload).not.toHaveProperty('candidates');
  });

  it('still spreads current_etag from PreconditionFailedError', async () => {
    const { payload } = await runAndParse(async () => {
      throw new PreconditionFailedError('docs/foo.md', 'etag-123', 'stale');
    }, {});
    expect(payload.current_etag).toBe('etag-123');
  });

  it('spreads branch and conflicts from MergeConflictError', async () => {
    const { isError, payload } = await runAndParse(async () => {
      throw new MergeConflictError('propose/m/foo.md/20260429T000000Z', ['foo.md', 'bar.md']);
    }, {});
    expect(isError).toBe(true);
    expect(payload.error).toBe('merge_conflict');
    expect(payload.branch).toBe('propose/m/foo.md/20260429T000000Z');
    expect(payload.conflicts).toEqual(['foo.md', 'bar.md']);
    expect(payload.message).toContain('foo.md');
    expect(payload.message).toContain('bar.md');
  });
});

// #152 — absolute paths are canonicalised once, before the handler runs, so
// RBAC checks, logging and resolution all see the same root-prefixed path.
describe('wrapHandler absolute path canonicalisation', () => {
  const git = { enabled: null, auto_commit: true, remote: null, pr_hook: null };
  const rootsCtx = {
    config: {
      document_roots: {
        docs: { name: 'docs', path: '/data/docs', git },
        memory: { name: 'memory', path: '/data/memory', git },
      },
    },
  } as unknown as ToolContext;

  async function seenArgs(args: Record<string, unknown>) {
    let seen: Record<string, unknown> | undefined;
    const wrapped = wrapHandler<Record<string, unknown>>('test_tool', rootsCtx, async (a) => {
      seen = a;
      requirePermission(scopedCaller, 'read', a.file as string);
      return { ok: true };
    });
    const result = await wrapped(args);
    return { seen, result, payload: JSON.parse(result.content[0].text) };
  }

  const scopedCaller: CallerIdentity = {
    id: 'scoped',
    scopes: [{ path: 'docs/**', permissions: ['read'] }],
  } as CallerIdentity;

  it('rewrites absolute file/source/destination/target_file to root-prefixed form', async () => {
    const { seen } = await seenArgs({
      file: '/data/docs/a.md',
      source: '/data/docs/b.md',
      destination: '/data/memory/c.md',
      target_file: '/data/docs/d.md',
      scope: '/data/memory/notes',
      section: '/not/a/path',
    });
    expect(seen).toEqual({
      file: 'docs/a.md',
      source: 'docs/b.md',
      destination: 'memory/c.md',
      target_file: 'docs/d.md',
      scope: 'memory/notes',
      section: '/not/a/path',
    });
  });

  it('leaves root-prefixed paths and scopes untouched', async () => {
    const { seen } = await seenArgs({ file: 'docs/a.md', scope: '**' });
    expect(seen).toEqual({ file: 'docs/a.md', scope: '**' });
  });

  it('an RBAC scope written as a root-prefixed glob grants the absolute form', async () => {
    const { result } = await seenArgs({ file: '/data/docs/a.md' });
    expect(result.isError).toBeUndefined();
  });

  it('returns a validation error, without calling the handler, for a path outside every root', async () => {
    const { seen, result, payload } = await seenArgs({ file: '/etc/passwd' });
    expect(seen).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(payload.error).toBe('validation_error');
  });
});

// Clients read tool annotations from tools/list to decide which calls need
// approval, so they must survive attachment to a real MCP server.
describe('attachRegistry tool annotations', () => {
  it('publishes each tool\'s annotations in tools/list', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'probe_read',
      description: 'read probe',
      schema: { file: z.string() },
      annotations: READ_ONLY,
      handler: async () => ({}),
    });
    registry.register({
      name: 'probe_overwrite',
      description: 'overwrite probe',
      schema: {},
      annotations: OVERWRITE,
      handler: async () => ({}),
    });

    const server = new McpServer({ name: 'test', version: '0.0.0' });
    attachRegistry(server, registry, ctx);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map(t => [t.name, t]));
    expect(byName.probe_read.annotations).toEqual({
      readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
    });
    expect(byName.probe_overwrite.annotations).toEqual({
      readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false,
    });
    expect(byName.probe_read.inputSchema.properties).toHaveProperty('file');

    await client.close();
  });
});
