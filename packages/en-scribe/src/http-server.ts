// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { createServer as createHttpServer, type ServerResponse, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import {
  authenticateBearer,
  getLogger,
} from '@nullproof-studio/en-core';
import type {
  ResolvedConfig,
  CallerIdentity,
  RootContext,
} from '@nullproof-studio/en-core';

/**
 * Factory that builds the HTTP request handler for the MCP streamable-http
 * transport, wired to Bearer auth + per-session caller binding. Duplicated
 * from en-quire/src/http-server.ts by deliberate choice — the handlers are
 * 90%+ identical but the bins are published as separate packages, and a
 * refactor into en-core would couple all three. Keep the copies in sync by
 * hand; divergence between them is a signal to think twice rather than
 * drift quietly.
 *
 * Caller supplies `createMcpServer` — the factory that builds an McpServer
 * with the plain-text parser + text_* tool registry.
 */
export interface CreateHttpServerOptions {
  config: ResolvedConfig;
  db: Database.Database;
  roots: Record<string, RootContext>;
  createMcpServer: (deps: {
    config: ResolvedConfig;
    db: Database.Database;
    roots: Record<string, RootContext>;
    caller: CallerIdentity;
  }) => McpServer;
  realm: string; // for WWW-Authenticate, e.g. "en-scribe"
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
  const { config, db, roots, createMcpServer, realm } = options;
  const log = getLogger();

  const sessions = new Map<string, {
    server: McpServer;
    transport: StreamableHTTPServerTransport;
    callerId: string;
  }>();

  const unauthorized = (res: ServerResponse, reason: string) => {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer realm="${realm}"`,
    });
    res.end(JSON.stringify({ error: 'unauthorized', reason }));
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

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. Use /mcp or /health endpoints.' }));
      return;
    }

    const auth = authenticateBearer(req.headers.authorization, config.callers);
    if (!auth.ok) {
      log.debug('auth:rejected', { reason: auth.reason, path: url.pathname });
      unauthorized(res, auth.reason);
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
          unauthorized(res, 'session_caller_mismatch');
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
        unauthorized(res, 'session_caller_mismatch');
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

    const server = createMcpServer({ config, db, roots, caller: auth.caller });
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
