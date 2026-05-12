// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type Database from 'better-sqlite3';
import { getLogger } from '../shared/logger.js';

/**
 * Compile a SQLite-flavour GLOB pattern to a RegExp. Used for post-query
 * scope filtering on vector hits so the semantics match the fulltext
 * path's `file_path GLOB ?` exactly:
 *   - `*` matches zero or more characters of ANY kind, including `/`
 *   - `?` matches exactly one character
 *   - `[abc]` is a character class
 * Anchored. Cached per process — patterns are short and few.
 */
const _globCache = new Map<string, RegExp>();
function compileSqliteGlob(pattern: string): RegExp {
  const cached = _globCache.get(pattern);
  if (cached) return cached;
  let regex = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') regex += '.*';
    else if (c === '?') regex += '.';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end === -1) {
        regex += '\\[';
      } else {
        regex += pattern.slice(i, end + 1);
        i = end;
      }
    } else if (/[.+^${}()|\\]/.test(c)) {
      regex += `\\${c}`;
    } else {
      regex += c;
    }
  }
  regex += '$';
  const compiled = new RegExp(regex);
  _globCache.set(pattern, compiled);
  return compiled;
}

/**
 * Optional sqlite-vec wrapper.
 *
 * sqlite-vec is shipped as an `optionalDependencies` entry and a SQLite
 * loadable extension (.dylib / .so / .dll). On hosts where the loadable
 * isn't available (unsupported platform, npm install ran with
 * --no-optional), `loadVectorExtension` returns `{ loaded: false }` with
 * a warning string instead of throwing. Callers should treat that as a
 * signal to degrade to FTS-only rather than refuse to start.
 *
 * The schema is companion: `vec_sections` (the virtual vec0 table) is
 * keyed on rowid + embedding; `vec_section_meta` is a regular table
 * holding the file/section metadata (FTS-style virtual tables don't
 * support extra columns, so the join is explicit).
 */

interface VectorLoadResult {
  loaded: boolean;
  warning?: string;
}

let _loaded = false;

/**
 * Attempt to load the sqlite-vec extension into `db`. Idempotent at the
 * module level — once we've succeeded for any db, the import is cached;
 * the .so/.dll itself still has to be loaded per-connection by sqlite-vec.
 */
export async function loadVectorExtension(db: Database.Database): Promise<VectorLoadResult> {
  try {
    const mod = await import('sqlite-vec');
    mod.load(db);
    _loaded = true;
    return { loaded: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().warn('sqlite-vec unavailable — semantic search will degrade to FTS', {
      error: msg,
    });
    return { loaded: false, warning: msg };
  }
}

/** True after the extension has loaded successfully at least once in this process. */
export function isVectorAvailable(): boolean {
  return _loaded;
}

/**
 * Initialise the vector schema. Caller must have already called
 * `loadVectorExtension` and confirmed `loaded: true`. `dimensions` must
 * match the embedding model's output size; mismatches will surface as
 * insert errors.
 */
export function initVectorSchema(db: Database.Database, dimensions: number): void {
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(`vector dimensions must be a positive integer, got ${dimensions}`);
  }
  // The vec0 virtual table is created with a fixed dimension. Re-creating
  // with a different dimension would require dropping; we don't change
  // dimensions at runtime, so the IF NOT EXISTS guard is enough.
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS vec_sections USING vec0(
      rowid INTEGER PRIMARY KEY,
      embedding FLOAT[${dimensions}]
    );
    CREATE TABLE IF NOT EXISTS vec_section_meta (
      rowid INTEGER PRIMARY KEY,
      file_path TEXT NOT NULL,
      section_path TEXT NOT NULL,
      section_heading TEXT,
      section_level INTEGER,
      line_start INTEGER,
      line_end INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_vec_meta_file ON vec_section_meta(file_path);
  `);
}

export interface VectorMeta {
  file_path: string;
  section_path: string;
  section_heading: string;
  section_level: number;
  line_start: number;
  line_end: number;
}

/**
 * Insert or replace an embedding for a given (file, section_path) pair.
 * Returns the rowid used so callers can correlate with their own state.
 */
export function upsertEmbedding(
  db: Database.Database,
  meta: VectorMeta,
  embedding: Float32Array,
): number {
  // Look up existing rowid by (file_path, section_path) so re-indexing
  // a section replaces rather than duplicates.
  const existing = db.prepare(
    `SELECT rowid FROM vec_section_meta WHERE file_path = ? AND section_path = ?`,
  ).get(meta.file_path, meta.section_path) as { rowid: number } | undefined;

  let rowid: number;
  if (existing) {
    rowid = existing.rowid;
    db.prepare(
      `UPDATE vec_section_meta SET section_heading = ?, section_level = ?, line_start = ?, line_end = ? WHERE rowid = ?`,
    ).run(meta.section_heading, meta.section_level, meta.line_start, meta.line_end, rowid);
    db.prepare(`DELETE FROM vec_sections WHERE rowid = ?`).run(BigInt(rowid));
  } else {
    const result = db.prepare(
      `INSERT INTO vec_section_meta (file_path, section_path, section_heading, section_level, line_start, line_end)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      meta.file_path,
      meta.section_path,
      meta.section_heading,
      meta.section_level,
      meta.line_start,
      meta.line_end,
    );
    rowid = Number(result.lastInsertRowid);
  }

  // sqlite-vec's vec0 virtual table is strict about INTEGER vs REAL on the
  // primary key column; better-sqlite3 binds JS numbers as REAL via the
  // dynamic-typing path, which fails the vec0 type check. Bind as BigInt
  // so the binding goes down the SQLITE_INTEGER path explicitly.
  db.prepare(`INSERT INTO vec_sections (rowid, embedding) VALUES (?, ?)`)
    .run(BigInt(rowid), Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength));

  return rowid;
}

/** Remove every vector + meta row for a given file path. No-op when the
 *  vec_section_meta table doesn't exist (semantic disabled — sqlite-vec
 *  was never loaded and `initVectorSchema` was never called). This lets
 *  generic write/index cleanup paths call it unconditionally. */
export function removeEmbeddingsForFile(db: Database.Database, file_path: string): void {
  const exists = db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vec_section_meta'`,
  ).get();
  if (!exists) return;

  const rows = db.prepare(`SELECT rowid FROM vec_section_meta WHERE file_path = ?`).all(file_path) as Array<{ rowid: number }>;
  if (rows.length === 0) return;
  const placeholders = rows.map(() => '?').join(',');
  const ids = rows.map((r) => r.rowid);
  db.prepare(`DELETE FROM vec_sections WHERE rowid IN (${placeholders})`).run(...ids.map(BigInt));
  db.prepare(`DELETE FROM vec_section_meta WHERE file_path = ?`).run(file_path);
}

export interface VectorSearchResult {
  file_path: string;
  section_path: string;
  section_heading: string;
  section_level: number;
  line_start: number;
  line_end: number;
  distance: number;
}

/** Hard ceiling on the kNN candidate window when expanding under a narrow
 *  scope. Past this we'd rather return what we have than scan the whole
 *  vec index — pathological scopes (matching almost nothing) shouldn't
 *  amount to a full table scan disguised as an ANN query. */
const VECTOR_MAX_K = 10_000;

/**
 * Run a kNN query against the vec0 index. Lower `distance` is closer.
 *
 * Scope semantics match the fulltext path's `file_path GLOB ?` (see
 * `compileSqliteGlob` above). The filter is applied post-query, so when
 * a narrow scope eliminates most of the global top-k candidates, we
 * iteratively double the kNN window until we have enough scoped hits or
 * either (a) the index is exhausted or (b) we hit `VECTOR_MAX_K`.
 *
 * Without expansion, a tight scope on a large index can return empty
 * results even when many in-scope vectors exist — they just sit outside
 * the global top-k window. The trade-off is more work per query when
 * the scope is selective, which is correct: the caller asked for hits
 * within a narrow slice, so we have to look harder.
 */
export function vectorSearch(
  db: Database.Database,
  query: Float32Array,
  limit: number,
  scope?: string,
): VectorSearchResult[] {
  const queryBlob = Buffer.from(query.buffer, query.byteOffset, query.byteLength);

  const knnStmt = db.prepare(
    `SELECT v.rowid, v.distance, m.file_path, m.section_path, m.section_heading,
            m.section_level, m.line_start, m.line_end
     FROM vec_sections v
     JOIN vec_section_meta m ON m.rowid = v.rowid
     WHERE v.embedding MATCH ? AND k = ?`,
  );

  type Row = {
    distance: number;
    file_path: string;
    section_path: string;
    section_heading: string;
    section_level: number;
    line_start: number;
    line_end: number;
  };

  const scopeRegex = scope
    ? compileSqliteGlob(scope.includes('*') ? scope : `${scope}*`)
    : null;

  let k = scopeRegex ? Math.max(limit * 3, 50) : limit;
  if (k > VECTOR_MAX_K) k = VECTOR_MAX_K;

  let filtered: Row[] = [];

  // Expand `k` until we have enough scoped hits, or the index returns
  // fewer rows than asked (exhausted), or we hit the safety cap.
  for (;;) {
    const rows = knnStmt.all(queryBlob, k) as Row[];
    filtered = scopeRegex ? rows.filter((r) => scopeRegex.test(r.file_path)) : rows;

    if (filtered.length >= limit) break;
    if (rows.length < k) break; // index is smaller than the candidate window
    if (k >= VECTOR_MAX_K) break;

    k = Math.min(k * 2, VECTOR_MAX_K);
  }

  return filtered.slice(0, limit).map((r) => ({
    file_path: r.file_path,
    section_path: r.section_path,
    section_heading: r.section_heading,
    section_level: r.section_level,
    line_start: r.line_start,
    line_end: r.line_end,
    distance: r.distance,
  }));
}
