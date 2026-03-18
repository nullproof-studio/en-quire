// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type Database from 'better-sqlite3';
import type { ResolvedConfig, CallerIdentity } from '../shared/types.js';
import type { GitOperations } from '../git/operations.js';

/**
 * Context passed to all tool handlers.
 * Provides access to configuration, caller identity, database, and git.
 */
export interface ToolContext {
  config: ResolvedConfig;
  documentRoot: string;
  caller: CallerIdentity;
  db: Database.Database;
  git: GitOperations | null;
}
