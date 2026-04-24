// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type Database from 'better-sqlite3';
import type { ResolvedConfig, CallerIdentity, ResolvedRoot } from '../shared/types.js';
import type { GitOperations } from '../git/operations.js';

/** Per-root runtime state (git instance, resolved config) */
export interface RootContext {
  root: ResolvedRoot;
  git: GitOperations | null;
}

/**
 * Context passed to all tool handlers.
 * Provides access to configuration, caller identity, database, and per-root state.
 */
export interface ToolContext {
  config: ResolvedConfig;
  roots: Record<string, RootContext>;
  caller: CallerIdentity;
  db: Database.Database;
}
