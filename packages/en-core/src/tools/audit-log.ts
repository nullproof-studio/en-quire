// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { requirePermission } from '../rbac/permissions.js';

/**
 * Admin-gated query over the `exec_audit_log` table written by `doc_exec`.
 *
 * Permission: `exec` on `**` — the same gate as `doc_exec` itself. A caller
 * permitted to run privileged commands is also permitted to read the trail
 * those commands left behind, and no one else.
 *
 * The full stdout/stderr captured at write time can be up to 10kB per row
 * (see `logExecAudit`); responses truncate each to 500 chars to keep agent
 * context windows manageable. Operators wanting full output can query the
 * table directly.
 */

const RESPONSE_TRUNC = 500;

export const AuditLogQuerySchema = z.object({
  start_date: z.string().optional().describe(
    'ISO 8601 timestamp (inclusive lower bound on `timestamp`). Compared lexicographically — pass full ISO strings.',
  ),
  end_date: z.string().optional().describe(
    'ISO 8601 timestamp (inclusive upper bound on `timestamp`).',
  ),
  caller: z.string().optional().describe('Exact caller id to filter by.'),
  command_pattern: z.string().optional().describe(
    'Substring to match against the recorded command (case-sensitive). Wildcard characters are not interpreted.',
  ),
  limit: z.number().int().positive().max(1000).default(100).describe(
    'Maximum number of entries to return (default 100, max 1000). Entries are returned newest-first; `total` reflects the unfiltered match count.',
  ),
});

export interface AuditLogEntry {
  id: number;
  caller: string;
  command: string;
  working_dir: string | null;
  exit_code: number | null;
  timestamp: string;
  stdout?: string;
  stderr?: string;
}

export interface AuditLogResponse {
  entries: AuditLogEntry[];
  total: number;
}

export async function handleAuditLog(
  args: z.infer<typeof AuditLogQuerySchema>,
  ctx: ToolContext,
): Promise<AuditLogResponse> {
  requirePermission(ctx.caller, 'exec', '**');

  // Apply schema defaults locally so the handler is correct whether it's
  // invoked through the MCP framework (which would parse) or directly from a
  // unit test (which passes the input shape unparsed).
  const limit = args.limit ?? 100;

  const where: string[] = [];
  const params: unknown[] = [];

  if (args.start_date) {
    where.push('timestamp >= ?');
    params.push(args.start_date);
  }
  if (args.end_date) {
    where.push('timestamp <= ?');
    params.push(args.end_date);
  }
  if (args.caller) {
    where.push('caller = ?');
    params.push(args.caller);
  }
  if (args.command_pattern) {
    // Server-wraps with `%` so callers don't have to think about LIKE wildcards.
    // Escape `%` and `_` in the input so they're treated as literals.
    const escaped = args.command_pattern.replace(/[\\%_]/g, (c) => `\\${c}`);
    where.push(`command LIKE ? ESCAPE '\\'`);
    params.push(`%${escaped}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = ctx.db.prepare(
    `SELECT COUNT(*) AS total FROM exec_audit_log ${whereSql}`,
  ).get(...params) as { total: number };

  const rows = ctx.db.prepare(
    `SELECT id, caller, command, working_dir, exit_code, timestamp, stdout, stderr
     FROM exec_audit_log
     ${whereSql}
     ORDER BY timestamp DESC, id DESC
     LIMIT ?`,
  ).all(...params, limit) as Array<{
    id: number;
    caller: string;
    command: string;
    working_dir: string | null;
    exit_code: number | null;
    timestamp: string;
    stdout: string | null;
    stderr: string | null;
  }>;

  const entries: AuditLogEntry[] = rows.map((r) => ({
    id: r.id,
    caller: r.caller,
    command: r.command,
    working_dir: r.working_dir,
    exit_code: r.exit_code,
    timestamp: r.timestamp,
    ...(r.stdout !== null && { stdout: r.stdout.slice(0, RESPONSE_TRUNC) }),
    ...(r.stderr !== null && { stderr: r.stderr.slice(0, RESPONSE_TRUNC) }),
  }));

  return { entries, total: totalRow.total };
}
