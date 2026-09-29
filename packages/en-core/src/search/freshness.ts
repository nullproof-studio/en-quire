// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type Database from 'better-sqlite3';
import { existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { safePath } from '../shared/file-utils.js';
import { getLogger } from '../shared/logger.js';
import { syncIndex } from './sync.js';

/**
 * Query-time index freshness (#137).
 *
 * The index is otherwise only refreshed at startup and on en-quire's own
 * writes, so files changed by anything else (editors, filesystem tools,
 * git pull) were served stale until restart. Before a search we bring the
 * scope up to date in two tiers, sized by what they cost:
 *
 * - Re-check indexed files (every search): stat each indexed file in scope,
 *   re-index the changed ones, drop the vanished ones. No directory walk —
 *   sub-millisecond for hundreds of files — and it covers edits and deletes.
 * - Walk for new files (throttled): a directory walk is the expensive part
 *   on roots with large non-document trees, so a folder/root is walked at
 *   most once per `rescanIntervalMs`. A walk of an ancestor counts. A
 *   single-file scope is always checked directly.
 */

const lastWalk = new WeakMap<Database.Database, Map<string, number>>();

function walkTimes(db: Database.Database): Map<string, number> {
  let m = lastWalk.get(db);
  if (!m) {
    m = new Map();
    lastWalk.set(db, m);
  }
  return m;
}

/** Record a full walk of a root (e.g. the startup sync) so the next search needn't repeat it. */
export function markRootWalked(db: Database.Database, rootName: string, now: number = Date.now()): void {
  walkTimes(db).set(rootName, now);
}

export interface RefreshOptions {
  rescanIntervalMs: number;
  batchSize?: number;
  now?: number;
}

export interface RefreshResult {
  indexed: number;
  removed: number;
  /** Keys ("root" or "root/sub/path") that were walked for new files. */
  walked: string[];
  elapsed_ms: number;
}

interface Target {
  rootName: string;
  rootPath: string;
  subPath?: string;
  isFile: boolean;
}

/**
 * Resolve a doc_search scope ("root", "root/folder", "root/file.md", a
 * prefix, or a glob) to the roots and sub-paths it can match. Search treats
 * scope as a path prefix, so a partial or glob segment widens to the
 * nearest existing folder rather than missing files.
 */
function resolveTargets(roots: Record<string, { path: string }>, scope: string | undefined): Target[] {
  const all = () => Object.entries(roots).map(([rootName, r]) => ({ rootName, rootPath: r.path, isFile: false }));
  if (!scope) return all();

  const segments = scope.split('/');
  const root = roots[segments[0]];
  if (!root) return all();

  const literal: string[] = [];
  for (const seg of segments.slice(1)) {
    if (/[*?[]/.test(seg)) break;
    literal.push(seg);
  }
  let subPath: string | undefined = literal.join('/') || undefined;

  while (subPath) {
    let abs: string;
    try {
      abs = safePath(root.path, subPath);
    } catch {
      return [{ rootName: segments[0], rootPath: root.path, isFile: false }];
    }
    if (existsSync(abs)) {
      return [{ rootName: segments[0], rootPath: root.path, subPath, isFile: statSync(abs).isFile() }];
    }
    const parent = dirname(subPath);
    subPath = parent === '.' ? undefined : parent;
  }
  return [{ rootName: segments[0], rootPath: root.path, isFile: false }];
}

function walkedRecently(times: Map<string, number>, key: string, now: number, intervalMs: number): boolean {
  const parts = key.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const t = times.get(parts.slice(0, i).join('/'));
    if (t !== undefined && now - t < intervalMs) return true;
  }
  return false;
}

export function refreshIndexForScope(
  db: Database.Database,
  roots: Record<string, { path: string }>,
  scope: string | undefined,
  options: RefreshOptions,
): RefreshResult {
  const start = performance.now();
  const now = options.now ?? Date.now();
  const times = walkTimes(db);
  const result: RefreshResult = { indexed: 0, removed: 0, walked: [], elapsed_ms: 0 };

  for (const t of resolveTargets(roots, scope)) {
    const key = t.subPath ? `${t.rootName}/${t.subPath}` : t.rootName;
    const walk = t.isFile || !walkedRecently(times, key, now, options.rescanIntervalMs);
    const r = syncIndex(db, t.rootName, t.rootPath, options.batchSize, {
      subPath: t.subPath,
      walk,
      dropEmbeddings: true,
      linkScan: 'on-change',
    });
    result.indexed += r.indexed;
    result.removed += r.removed;
    if (walk && !t.isFile) {
      times.set(key, now);
      result.walked.push(key);
    }
  }

  result.elapsed_ms = Math.round((performance.now() - start) * 100) / 100;
  if (result.indexed > 0 || result.removed > 0 || result.walked.length > 0) {
    getLogger().debug('search:refresh', { scope: scope ?? '*', ...result });
  }
  return result;
}
