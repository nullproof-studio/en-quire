#!/usr/bin/env node
// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { parseArgs } from 'node:util';
import { createServer as createHttpServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type Database from 'better-sqlite3';
import {
  loadConfig,
  openDatabase,
  syncIndex,
  GitOperations,
  resolveCaller,
  authenticateBearer,
  initLogger,
  getLogger,
  ToolRegistry,
  attachRegistry,
} from '@nullproof-studio/en-core';
import type {
  ResolvedConfig,
  CallerIdentity,
  ToolContext,
  RootContext,
} from '@nullproof-studio/en-core';
// Register plain-text parser (side-effect import)
import './parsers/plaintext-parser.js';
import { registerEnScribeTools } from './plugin.js';

interface ServerDependencies {
  config: ResolvedConfig;
  db: Database.Database;
  roots: Record<string, RootContext>;
  caller: CallerIdentity;
}

function createServer(deps: ServerDependencies): McpServer {
  const server = new McpServer({
    name: 'en-scribe',
    version: '0.1.0',
  });

  const ctx: ToolContext = {
    config: deps.config,
    roots: deps.roots,
    caller: deps.caller,
    db: deps.db,
  };

  const registry = new ToolRegistry();
  registerEnScribeTools(registry);
  attachRegistry(server, registry, ctx);

  return server;
}

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c', default: 'en-scribe.config.yaml' },
    },
    strict: false,
  });

  const configPath = values.config as string;

  const config = loadConfig(configPath);

  initLogger(config.logging, 'en-scribe');
  const log = getLogger();

  const db = openDatabase(config.database);

  const roots: Record<string, RootContext> = {};
  for (const [name, root] of Object.entries(config.document_roots)) {
    const git = new GitOperations(root.path, root.git.enabled);
    roots[name] = { root, git };
    log.info('Root configured', {
      name,
      path: root.path,
      git: git.available,
      description: root.description,
    });
  }

  // Plaintext index sync — a single FTS row per file via the whole-file
  // pseudo-section. Line-chunked indexing for text_search ships later.
  for (const [name, root] of Object.entries(config.document_roots)) {
    if (config.search.sync_on_start === 'background') {
      log.info('Index sync starting in background', { root: name });
      setImmediate(() => {
        try {
          const syncResult = syncIndex(db, name, root.path, config.search.batch_size);
          log.info('Index sync complete', {
            root: name,
            indexed: syncResult.indexed,
            skipped: syncResult.skipped,
            removed: syncResult.removed,
            elapsed_ms: syncResult.elapsed_ms,
          });
        } catch (err) {
          log.error('Index sync failed', { root: name, error: String(err) });
        }
      });
    } else {
      const syncResult = syncIndex(db, name, root.path, config.search.batch_size);
      log.info('Index sync', {
        root: name,
        indexed: syncResult.indexed,
        skipped: syncResult.skipped,
        removed: syncResult.removed,
        elapsed_ms: syncResult.elapsed_ms,
      });
    }
  }

  if (config.transport === 'streamable-http') {
    // HTTP transport MUST NOT use the resolveCaller auto-select fallback —
    // every request authenticates its own caller via Bearer token.
    await startHttpTransport(config, db, roots);
  } else {
    const caller = resolveCaller(config);
    await startStdioTransport(config, db, roots, caller);
  }
}

async function startStdioTransport(
  config: ReturnType<typeof loadConfig>,
  db: ReturnType<typeof openDatabase>,
  roots: Record<string, RootContext>,
  caller: ReturnType<typeof resolveCaller>,
) {
  const log = getLogger();
  const server = createServer({ config, db, roots, caller });
  const transport = new StdioServerTransport();

  log.info('Server starting on stdio', {
    roots: Object.keys(config.document_roots),
  });
  await server.connect(transport);
}

async function startHttpTransport(
  config: ReturnType<typeof loadConfig>,
  db: ReturnType<typeof openDatabase>,
  roots: Record<string, RootContext>,
) {
  const log = getLogger();

  const sessions = new Map<string, {
    server: ReturnType<typeof createServer>;
    transport: StreamableHTTPServerTransport;
    callerId: string;
  }>();

  const MAX_REQUEST_BODY = 10 * 1024 * 1024;

  const unauthorized = (res: ServerResponse, reason: string) => {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="en-scribe"',
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

    // /health is intentionally unauthenticated.
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

    // Bearer auth gate — runs BEFORE any session lookup or allocation.
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

    const server = createServer({ config, db, roots, caller: auth.caller });
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

  const port = config.port;
  const host = config.listen_host;
  httpServer.listen(port, host, () => {
    log.info('Server listening', {
      transport: 'streamable-http',
      host,
      port,
      roots: Object.keys(config.document_roots),
    });
    if (host === '0.0.0.0') {
      log.warn('HTTP server bound to 0.0.0.0 — exposed on every interface. ' +
        'Confirm this is intentional and that caller keys are strong.');
    }
  });

  const shutdown = async () => {
    log.info('Shutting down', { active_sessions: sessions.size });
    for (const [, session] of sessions) {
      await session.transport.close();
    }
    sessions.clear();
    httpServer.close();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  const log = getLogger();
  log.error('Fatal error', { error: String(err) });
  process.exit(1);
});
