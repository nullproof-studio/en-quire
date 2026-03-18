#!/usr/bin/env node
// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { parseArgs } from 'node:util';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig } from './config/loader.js';
import { openDatabase } from './search/database.js';
import { syncIndex } from './search/sync.js';
import { GitOperations } from './git/operations.js';
import { resolveCaller } from './rbac/resolver.js';
import { createServer } from './server.js';
import { initLogger, getLogger } from './shared/logger.js';

async function main() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c', default: 'en-quire.config.yaml' },
    },
    strict: false,
  });

  const configPath = values.config as string;

  // Load configuration
  const config = loadConfig(configPath);

  // Initialise logging
  initLogger(config.logging);
  const log = getLogger();

  // Open search database
  const db = openDatabase(config.document_root);

  // Initialise git operations
  const git = new GitOperations(config.document_root, config.git.enabled);

  // Resolve caller identity (for stdio, uses config defaults)
  const caller = resolveCaller(config);

  // Sync search index
  if (config.search.sync_on_start === 'background') {
    log.info('Index sync starting in background');
    setImmediate(() => {
      try {
        const syncResult = syncIndex(db, config.document_root, config.search.batch_size);
        log.info('Index sync complete', {
          indexed: syncResult.indexed,
          skipped: syncResult.skipped,
          removed: syncResult.removed,
          elapsed_ms: syncResult.elapsed_ms,
        });
      } catch (err) {
        log.error('Index sync failed', { error: String(err) });
      }
    });
  } else {
    const syncResult = syncIndex(db, config.document_root, config.search.batch_size);
    log.info('Index sync', {
      indexed: syncResult.indexed,
      skipped: syncResult.skipped,
      removed: syncResult.removed,
      elapsed_ms: syncResult.elapsed_ms,
    });
  }

  if (config.transport === 'streamable-http') {
    await startHttpTransport(config, db, git, caller);
  } else {
    await startStdioTransport(config, db, git, caller);
  }
}

async function startStdioTransport(
  config: ReturnType<typeof loadConfig>,
  db: ReturnType<typeof openDatabase>,
  git: GitOperations,
  caller: ReturnType<typeof resolveCaller>,
) {
  const log = getLogger();
  const server = createServer({ config, db, git, caller });
  const transport = new StdioServerTransport();

  log.info('Server starting on stdio', { document_root: config.document_root });
  await server.connect(transport);
}

async function startHttpTransport(
  config: ReturnType<typeof loadConfig>,
  db: ReturnType<typeof openDatabase>,
  git: GitOperations,
  caller: ReturnType<typeof resolveCaller>,
) {
  const log = getLogger();

  // Map of session ID → transport for stateful session management
  const sessions = new Map<string, { server: ReturnType<typeof createServer>; transport: StreamableHTTPServerTransport }>();

  const MAX_REQUEST_BODY = 10 * 1024 * 1024; // 10 MB

  const httpServer = createHttpServer(async (req, res) => {
    // Reject oversized requests early
    const contentLength = parseInt(req.headers['content-length'] ?? '0', 10);
    if (contentLength > MAX_REQUEST_BODY) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request body too large. Maximum 10 MB.' }));
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // Health check endpoint
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

    // Handle DELETE for session termination
    if (req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
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

    // For GET and POST, route to existing session or create new one
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Existing session
      await sessions.get(sessionId)!.transport.handleRequest(req, res);
      return;
    }

    if (sessionId && !sessions.has(sessionId)) {
      // Invalid session ID
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Session not found' }));
      return;
    }

    // No session ID — create a new session (initialization request)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const server = createServer({ config, db, git, caller });
    await server.connect(transport);

    // Store session once we know the ID (after handleRequest processes the init)
    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
        log.debug('Session closed', { sessionId: transport.sessionId });
      }
    };

    await transport.handleRequest(req, res);

    // After handling the init request, the session ID is set
    if (transport.sessionId) {
      sessions.set(transport.sessionId, { server, transport });
      log.debug('Session created', { sessionId: transport.sessionId });
    }
  });

  // Harden HTTP server defaults
  httpServer.maxHeadersCount = 50;
  httpServer.headersTimeout = 20000; // 20s to send headers
  httpServer.requestTimeout = 120000; // 2min total request timeout

  const port = config.port;
  httpServer.listen(port, () => {
    log.info('Server listening', { transport: 'streamable-http', port, document_root: config.document_root });
  });

  // Graceful shutdown
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
