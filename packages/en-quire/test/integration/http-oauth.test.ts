// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { generateKeyPair, exportJWK, SignJWT, type JWK } from 'jose';
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
 * End-to-end tests for the `oauth-external` auth backend over the real HTTP
 * transport. A local JWKS server stands in for the IdP; tokens are signed with
 * its private key. Proves the wiring the unit tests can't: discovery serving,
 * the 401 `resource_metadata` challenge, JWT-bound session creation, and the
 * 403 "authenticated but no grants" path.
 */

const RESOURCE = 'https://docs.example.com/mcp';

let jwksServer: Server;
let jwksUri: string;
let privateKey: CryptoKey;
let issuer: string;

let rootDir: string;
let db: Database.Database;
let baseUrl: string;
let httpServer: Awaited<ReturnType<typeof createMcpHttpServer>>['httpServer'];
let sessions: Awaited<ReturnType<typeof createMcpHttpServer>>['sessions'];

function makeMcpServer(deps: { config: ResolvedConfig; db: Database.Database; roots: Record<string, RootContext>; caller: CallerIdentity }): McpServer {
  const server = new McpServer({ name: 'en-quire-test', version: '0.0.0' });
  const ctx: ToolContext = { config: deps.config, roots: deps.roots, caller: deps.caller, db: deps.db };
  attachRegistry(server, new ToolRegistry(), ctx);
  return server;
}

function makeConfig(rootDir: string): ResolvedConfig {
  return {
    document_roots: {
      notes: { name: 'notes', path: rootDir, git: { enabled: false, auto_commit: false, remote: null, pr_hook: null } },
    },
    database: ':memory:',
    transport: 'streamable-http',
    port: 0,
    listen_host: '127.0.0.1',
    search: { sync_on_start: 'blocking', batch_size: 100, semantic: { enabled: false } },
    logging: { level: 'error', dir: null },
    callers: {},
    require_read_before_write: false,
    rbac: {
      roles: { editor: [{ path: '**', permissions: ['read', 'search'] }] },
      local_groups: {},
      bindings: [{ idp_group: 'docs-editors', roles: ['editor'] }],
      default_role: null,
    },
    auth: {
      mode: 'oauth-external',
      resource: RESOURCE,
      providers: [{
        issuer,
        jwks_uri: jwksUri,
        audience: RESOURCE,
        algorithms: ['RS256'],
        subject_claim: 'email',
        groups_claim: 'groups',
      }],
    },
  };
}

async function signToken(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(RESOURCE)
    .setExpirationTime('2h')
    .sign(privateKey);
}

beforeEach(async () => {
  initLogger({ level: 'error', dir: null }, 'en-quire');

  // Local JWKS server playing the IdP.
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey as CryptoKey;
  const publicJwk: JWK = { ...(await exportJWK(kp.publicKey)), alg: 'RS256', use: 'sig', kid: 'k1' };
  jwksServer = createServer((req, res) => {
    if (req.url === '/jwks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [publicJwk] }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', () => resolve()));
  const jwksPort = (jwksServer.address() as AddressInfo).port;
  issuer = `http://127.0.0.1:${jwksPort}/`;
  jwksUri = `http://127.0.0.1:${jwksPort}/jwks`;

  rootDir = mkdtempSync(join(tmpdir(), 'http-oauth-integration-'));
  db = new Database(':memory:');
  initSearchSchema(db);

  const config = makeConfig(rootDir);
  const roots: Record<string, RootContext> = {
    notes: { root: config.document_roots.notes, git: new GitOperations(rootDir, false) },
  };

  const built = createMcpHttpServer({ config, db, roots, createMcpServer: makeMcpServer, realm: 'en-quire' });
  httpServer = built.httpServer;
  sessions = built.sessions;
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
  db.close();
  rmSync(rootDir, { recursive: true, force: true });
});

function initBody() {
  return JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
  });
}

describe('HTTP transport — oauth-external (integration)', () => {
  it('serves protected-resource discovery metadata unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
    expect(res.status).toBe(200);
    const body = await res.json() as { resource: string; authorization_servers: string[] };
    expect(body.resource).toBe(RESOURCE);
    expect(body.authorization_servers).toContain(issuer);
  });

  it('rejects /mcp without a token, advertising resource_metadata', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
      body: initBody(),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
    expect(sessions.size).toBe(0);
  });

  it('accepts a valid JWT and creates a session bound to the subject', async () => {
    const token = await signToken({ email: 'alice@example.com', groups: ['docs-editors'] });
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: initBody(),
    });
    expect(res.status).toBe(200);
    const sessionId = res.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();
    expect(sessions.get(sessionId!)?.callerId).toBe('alice@example.com');
  });

  it('returns 403 for a valid token that the policy grants nothing', async () => {
    const token = await signToken({ email: 'nobody@example.com', groups: ['unmapped'] });
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: initBody(),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string; reason: string };
    expect(body.error).toBe('forbidden');
    expect(body.reason).toBe('no_grants');
    expect(sessions.size).toBe(0);
  });
});
