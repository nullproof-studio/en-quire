// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  initSearchSchema,
  GitOperations,
  ToolRegistry,
  attachRegistry,
  initLogger,
} from '@nullproof-studio/en-core';
import type {
  ResolvedConfig,
  RootContext,
  CallerIdentity,
  ToolContext,
} from '@nullproof-studio/en-core';
import { createMcpHttpServer } from '../../src/http-server.js';

/**
 * End-to-end tests for the HTTP transport's auth wiring (#69). These start
 * a real `http.Server` on port 0, bound to loopback, and exercise the five
 * scenarios the unit tests can't prove:
 *
 *   1. Unauthenticated /mcp → 401, WWW-Authenticate header, no session
 *   2. Wrong token → 401
 *   3. Valid token → initialize handshake succeeds, session created
 *   4. Swapped-token-on-same-session → 401 session_caller_mismatch
 *   5. /health remains unauthenticated
 *
 * The whole stack is imported, not spawned, so failures show real stack
 * traces. The MCP server factory uses a minimal empty tool registry —
 * we're testing auth wiring, not tool behaviour.
 */

const STRONG_TOKEN_ALICE = 'sk-alice-a1B2c3D4e5F6g7H8i9J0kLmNoPqR';
const STRONG_TOKEN_BOB = 'sk-bob-Z9y8x7w6V5u4T3s2R1q0pOnMlKjIhG';

function makeConfig(rootDir: string): ResolvedConfig {
  return {
    document_roots: {
      notes: {
        name: 'notes',
        path: rootDir,
        git: { enabled: false, auto_commit: false, remote: null, pr_hook: null },
      },
    },
    database: ':memory:',
    transport: 'streamable-http',
    port: 0,
    listen_host: '127.0.0.1',
    search: { sync_on_start: 'blocking', batch_size: 100, semantic: { enabled: false } },
    logging: { level: 'error', dir: null },
    callers: {
      alice: {
        key: STRONG_TOKEN_ALICE,
        scopes: [{ path: '**', permissions: ['read'] }],
      },
      bob: {
        key: STRONG_TOKEN_BOB,
        scopes: [{ path: '**', permissions: ['read'] }],
      },
    },
    require_read_before_write: false,
  };
}

function makeMcpServer(deps: { config: ResolvedConfig; db: Database.Database; roots: Record<string, RootContext>; caller: CallerIdentity }): McpServer {
  const server = new McpServer({ name: 'en-quire-test', version: '0.0.0' });
  const ctx: ToolContext = { config: deps.config, roots: deps.roots, caller: deps.caller, db: deps.db };
  const registry = new ToolRegistry();
  attachRegistry(server, registry, ctx);
  return server;
}

let rootDir: string;
let db: Database.Database;
let baseUrl: string;
let httpServer: Awaited<ReturnType<typeof createMcpHttpServer>>['httpServer'];
let sessions: Awaited<ReturnType<typeof createMcpHttpServer>>['sessions'];

beforeEach(async () => {
  initLogger({ level: 'error', dir: null }, 'en-quire');
  rootDir = mkdtempSync(join(tmpdir(), 'http-auth-integration-'));
  db = new Database(':memory:');
  initSearchSchema(db);

  const config = makeConfig(rootDir);
  const roots: Record<string, RootContext> = {
    notes: {
      root: config.document_roots.notes,
      git: new GitOperations(rootDir, false),
    },
  };

  const built = createMcpHttpServer({
    config, db, roots,
    createMcpServer: makeMcpServer,
    realm: 'en-quire',
  });
  httpServer = built.httpServer;
  sessions = built.sessions;

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  db.close();
  rmSync(rootDir, { recursive: true, force: true });
});

describe('HTTP transport — auth wiring (integration)', () => {
  it('rejects /mcp without Authorization with 401 and WWW-Authenticate', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
    const body = await res.json() as { error: string; reason: string };
    expect(body.error).toBe('unauthorized');
    expect(body.reason).toBe('missing');

    // No session should have been allocated
    expect(sessions.size).toBe(0);
  });

  it('rejects /mcp with a wrong token — same 401 shape', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer sk-wrong-4444444444444444444444444444444',
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { reason: string };
    expect(body.reason).toBe('invalid');
    expect(sessions.size).toBe(0);
  });

  it('accepts /mcp with a valid token and creates a caller-bound session', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRONG_TOKEN_ALICE}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      }),
    });
    expect(res.status).toBe(200);
    const sessionId = res.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();
    expect(sessions.size).toBe(1);
    expect(sessions.get(sessionId!)?.callerId).toBe('alice');
  });

  it('rejects a request that reuses a session ID but swaps the token', async () => {
    // Open a session as alice
    const initRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRONG_TOKEN_ALICE}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      }),
    });
    expect(initRes.status).toBe(200);
    const sessionId = initRes.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();

    // Now reuse the session with bob's token — must be rejected
    const hijackRes = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRONG_TOKEN_BOB}`,
        'mcp-session-id': sessionId!,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
      }),
    });
    expect(hijackRes.status).toBe(401);
    const body = await hijackRes.json() as { reason: string };
    expect(body.reason).toBe('session_caller_mismatch');

    // Original session is still intact — not destroyed by the hijack attempt
    expect(sessions.get(sessionId!)?.callerId).toBe('alice');
  });

  it('serves /health without authentication', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; sessions: number };
    expect(body.status).toBe('ok');
    expect(body.sessions).toBe(0);
  });

  it('rejects /health with authentication still passes (auth not required but not rejected)', async () => {
    // Minor regression guard: having Authorization on /health shouldn't 4xx.
    const res = await fetch(`${baseUrl}/health`, {
      headers: { 'Authorization': `Bearer ${STRONG_TOKEN_ALICE}` },
    });
    expect(res.status).toBe(200);
  });
});
