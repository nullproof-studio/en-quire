#!/usr/bin/env node
// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { parseArgs } from 'node:util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type Database from 'better-sqlite3';
import {
  loadConfig,
  openDatabase,
  syncIndex,
  GitOperations,
  resolveCaller,
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
// Register format parsers (side-effect imports)
import './parsers/markdown-parser.js';
import './parsers/yaml-parser.js';
import './parsers/jsonl-parser.js';
import { registerEnQuireTools } from './plugin.js';
import { createMcpHttpServer } from './http-server.js';

interface ServerDependencies {
  config: ResolvedConfig;
  db: Database.Database;
  roots: Record<string, RootContext>;
  caller: CallerIdentity;
}

function createServer(deps: ServerDependencies): McpServer {
  const server = new McpServer({
    name: 'en-quire',
    version: '0.2.0',
  });

  const ctx: ToolContext = {
    config: deps.config,
    roots: deps.roots,
    caller: deps.caller,
    db: deps.db,
  };

  const registry = new ToolRegistry();
  registerEnQuireTools(registry);
  attachRegistry(server, registry, ctx);

  return server;
}

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
  initLogger(config.logging, 'en-quire');
  const log = getLogger();

  // Open search database (shared across all roots)
  const db = openDatabase(config.database);

  // Initialise per-root state (git operations)
  const roots: Record<string, RootContext> = {};
  for (const [name, root] of Object.entries(config.document_roots)) {
    const git = new GitOperations(
      root.path,
      root.git.enabled,
      root.git.default_branch,
      root.git.remote,
      root.git.push_proposals,
      root.git.pr_hook,
    );
    roots[name] = { root, git };
    log.info('Root configured', {
      name,
      path: root.path,
      git: git.available,
      description: root.description,
    });
  }

  // Sync search index per root
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
    // stdio is inherently single-process; the startup-resolved caller is safe.
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

  const { httpServer, sessions } = createMcpHttpServer({
    config, db, roots,
    createMcpServer: (deps) => createServer(deps),
    realm: 'en-quire',
  });

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
