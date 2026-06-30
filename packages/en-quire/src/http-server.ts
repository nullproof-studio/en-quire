// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { createServer as createHttpServer, type ServerResponse, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import {
  createAuthBackend,
  getLogger,
} from '@nullproof-studio/en-core';
import type {
  ResolvedConfig,
  CallerIdentity,
  RootContext,
  EmbeddingsClient,
} from '@nullproof-studio/en-core';

/**
 * Factory that builds the HTTP request handler for the MCP streamable-http
 * transport, wired to Bearer auth + per-session caller binding. Exported so
 * integration tests can exercise the same handler bin.ts uses without having
 * to spawn the full bin as a subprocess.
 *
 * Caller supplies `createMcpServer` — the factory that builds an McpServer
 * with the right tool registry + format parsers for the binary (en-quire
 * registers markdown/yaml/jsonl, en-scribe registers plain-text).
 */
export interface CreateHttpServerOptions {
  config: ResolvedConfig;
  db: Database.Database;
  roots: Record<string, RootContext>;
  embeddings?: EmbeddingsClient;
  createMcpServer: (deps: {
    config: ResolvedConfig;
    db: Database.Database;
    roots: Record<string, RootContext>;
    caller: CallerIdentity;
    embeddings?: EmbeddingsClient;
  }) => McpServer;
  realm: string; // for WWW-Authenticate, e.g. "en-quire"
}

export interface McpHttpServerHandle {
  /** The http.Server, NOT yet listening. Caller calls listen() and close(). */
  httpServer: HttpServer;
  /** Session map — exposed for integration test assertions. */
  sessions: Map<string, {
    server: McpServer;
    transport: StreamableHTTPServerTransport;
    callerId: string;
  }>;
}

const MAX_REQUEST_BODY = 10 * 1024 * 1024; // 10 MB

export function createMcpHttpServer(options: CreateHttpServerOptions): McpHttpServerHandle {
  const { config, db, roots, embeddings, createMcpServer, realm } = options;
  const log = getLogger();

  const sessions = new Map<string, {
    server: McpServer;
    transport: StreamableHTTPServerTransport;
    callerId: string;
  }>();

  // Pluggable authentication: static bearer keys (default) or OAuth 2.1
  // Resource Server token validation, selected by `config.auth.mode`.
  const authBackend = createAuthBackend(config, realm);
  const discoveryDocs = new Map(authBackend.discovery().map((d) => [d.path, d.body]));

  const denyAuth = (res: ServerResponse, status: 401 | 403, reason: string) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (status === 401) headers['WWW-Authenticate'] = authBackend.challenge();
    res.writeHead(status, headers);
    res.end(JSON.stringify({ error: status === 401 ? 'unauthorized' : 'forbidden', reason }));
  };

  const httpServer = createHttpServer(async (req, res) => {
    const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
    if (contentLength > MAX_REQUEST_BODY) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request body too large. Maximum 10 MB.' }));
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', sessions: sessions.size }));
      return;
    }

    // OAuth discovery metadata (e.g. /.well-known/oauth-protected-resource).
    // Unauthenticated by design — clients fetch it precisely to learn how to
    // authenticate. Empty for the bearer backend.
    if (req.method === 'GET' && discoveryDocs.has(url.pathname)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(discoveryDocs.get(url.pathname)));
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. Use /mcp or /health endpoints.' }));
      return;
    }

    const auth = await authBackend.authenticate(req.headers.authorization);
    if (!auth.ok) {
      log.debug('auth:rejected', { reason: auth.reason, status: auth.status, path: url.pathname });
      denyAuth(res, auth.status, auth.reason);
      return;
    }

    if (req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        if (session.callerId !== auth.caller.id) {
          log.warn('auth:session-caller-mismatch', {
            sessionId, expected: session.callerId, got: auth.caller.id,
          });
          denyAuth(res, 401, 'session_caller_mismatch');
          return;
        }
        await session.transport.close();
        sessions.delete(sessionId);
        log.debug('Session terminated', { sessionId });
        res.writeHead(200);
        res.end();
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
      }
      return;
    }

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      if (session.callerId !== auth.caller.id) {
        log.warn('auth:session-caller-mismatch', {
          sessionId, expected: session.callerId, got: auth.caller.id,
        });
        denyAuth(res, 401, 'session_caller_mismatch');
        return;
      }
      await session.transport.handleRequest(req, res);
      return;
    }

    if (sessionId && !sessions.has(sessionId)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const server = createMcpServer({ config, db, roots, caller: auth.caller, embeddings });
    await server.connect(transport);

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
        log.debug('Session closed', { sessionId: transport.sessionId });
      }
    };

    await transport.handleRequest(req, res);

    if (transport.sessionId) {
      sessions.set(transport.sessionId, {
        server, transport, callerId: auth.caller.id,
      });
      log.debug('Session created', { sessionId: transport.sessionId, caller: auth.caller.id });
    }
  });

  httpServer.maxHeadersCount = 50;
  httpServer.headersTimeout = 20000;
  httpServer.requestTimeout = 120000;

  return { httpServer, sessions };
}
