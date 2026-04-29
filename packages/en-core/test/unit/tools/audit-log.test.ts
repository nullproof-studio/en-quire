// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  handleAuditLog,
  AuditLogQuerySchema,
  initSearchSchema,
  logExecAudit,
  PermissionDeniedError,
} from '@nullproof-studio/en-core';
import type { ToolContext, CallerIdentity, ResolvedConfig } from '@nullproof-studio/en-core';
import type { z } from 'zod';

let db: Database.Database;

function buildContext(scopes: CallerIdentity['scopes']): ToolContext {
  const config: ResolvedConfig = {
    document_roots: {},
    database: ':memory:',
    transport: 'stdio',
    port: 3100,
    listen_host: '127.0.0.1',
    search: {
      fulltext: true,
      sync_on_start: 'blocking',
      batch_size: 500,
      semantic: { enabled: false },
    },
    logging: { level: 'error', dir: null },
    callers: {},
    require_read_before_write: true,
  };
  const caller: CallerIdentity = { id: 'admin', scopes };
  return { config, roots: {}, caller, db };
}

function seed(): void {
  // 6 rows spanning two callers, two commands, three dates
  const rows = [
    { caller: 'agent-a', command: 'ls -la', working_dir: '/docs', stdout: 'a.md\n', stderr: '', exit_code: 0, timestamp: '2026-04-25T10:00:00.000Z' },
    { caller: 'agent-a', command: 'cat README', working_dir: '/docs', stdout: 'hello\n', stderr: '', exit_code: 0, timestamp: '2026-04-26T11:00:00.000Z' },
    { caller: 'agent-b', command: 'ls -la', working_dir: '/sops', stdout: 'b.md\n', stderr: '', exit_code: 0, timestamp: '2026-04-26T12:00:00.000Z' },
    { caller: 'agent-b', command: 'rg foo', working_dir: '/sops', stdout: '', stderr: 'no matches\n', exit_code: 1, timestamp: '2026-04-27T09:00:00.000Z' },
    { caller: 'agent-a', command: 'ls -la', working_dir: '/docs', stdout: 'c.md\n', stderr: '', exit_code: 0, timestamp: '2026-04-27T13:00:00.000Z' },
    { caller: 'agent-c', command: 'echo hi', working_dir: undefined, stdout: 'hi\n', stderr: '', exit_code: 0, timestamp: '2026-04-28T08:00:00.000Z' },
  ];

  // Bypass logExecAudit's `new Date()` timestamp by inserting directly with
  // explicit timestamps, so date-range filtering is testable.
  const stmt = db.prepare(
    `INSERT INTO exec_audit_log (caller, command, working_dir, stdout, stderr, exit_code, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of rows) {
    stmt.run(r.caller, r.command, r.working_dir ?? null, r.stdout, r.stderr, r.exit_code, r.timestamp);
  }
}

beforeEach(() => {
  db = new Database(':memory:');
  initSearchSchema(db);
  seed();
});

afterEach(() => {
  db.close();
});

describe('handleAuditLog', () => {
  const adminScopes: CallerIdentity['scopes'] = [{ path: '**', permissions: ['exec'] }];

  it('returns recent entries newest-first with no filters', async () => {
    const ctx = buildContext(adminScopes);
    const args: z.infer<typeof AuditLogQuerySchema> = {};
    const result = await handleAuditLog(args, ctx) as {
      entries: Array<{ caller: string; command: string; timestamp: string }>;
      total: number;
    };
    expect(result.total).toBe(6);
    expect(result.entries).toHaveLength(6);
    expect(result.entries[0].timestamp).toBe('2026-04-28T08:00:00.000Z');
    expect(result.entries[5].timestamp).toBe('2026-04-25T10:00:00.000Z');
  });

  it('filters by caller', async () => {
    const ctx = buildContext(adminScopes);
    const args: z.infer<typeof AuditLogQuerySchema> = { caller: 'agent-a' };
    const result = await handleAuditLog(args, ctx) as {
      entries: Array<{ caller: string }>;
      total: number;
    };
    expect(result.total).toBe(3);
    expect(result.entries.every((e) => e.caller === 'agent-a')).toBe(true);
  });

  it('filters by inclusive date range', async () => {
    const ctx = buildContext(adminScopes);
    const args: z.infer<typeof AuditLogQuerySchema> = {
      start_date: '2026-04-26T00:00:00.000Z',
      end_date: '2026-04-27T23:59:59.000Z',
    };
    const result = await handleAuditLog(args, ctx) as {
      entries: Array<{ timestamp: string }>;
      total: number;
    };
    // Seeded rows in [2026-04-26, 2026-04-27]: 11:00, 12:00, 09:00, 13:00 = 4.
    expect(result.total).toBe(4);
    for (const e of result.entries) {
      expect(e.timestamp >= args.start_date!).toBe(true);
      expect(e.timestamp <= args.end_date!).toBe(true);
    }
  });

  it('filters by command substring (case-sensitive literal)', async () => {
    const ctx = buildContext(adminScopes);
    const args: z.infer<typeof AuditLogQuerySchema> = { command_pattern: 'ls -la' };
    const result = await handleAuditLog(args, ctx) as { total: number };
    expect(result.total).toBe(3);
  });

  it('respects limit (and reports the unfiltered total)', async () => {
    const ctx = buildContext(adminScopes);
    const args: z.infer<typeof AuditLogQuerySchema> = { limit: 2 };
    const result = await handleAuditLog(args, ctx) as {
      entries: unknown[];
      total: number;
    };
    expect(result.entries).toHaveLength(2);
    // total reflects matching rows pre-limit
    expect(result.total).toBe(6);
  });

  it('truncates stdout and stderr to 500 chars in the response', async () => {
    const big = 'x'.repeat(2000);
    db.prepare(
      `INSERT INTO exec_audit_log (caller, command, working_dir, stdout, stderr, exit_code, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('agent-big', 'big-cmd', null, big, big, 0, '2026-04-29T00:00:00.000Z');

    const ctx = buildContext(adminScopes);
    const args: z.infer<typeof AuditLogQuerySchema> = { caller: 'agent-big' };
    const result = await handleAuditLog(args, ctx) as {
      entries: Array<{ stdout?: string; stderr?: string }>;
    };
    expect(result.entries[0].stdout?.length).toBe(500);
    expect(result.entries[0].stderr?.length).toBe(500);
  });

  it('rejects callers without exec permission', async () => {
    const ctx = buildContext([{ path: '**', permissions: ['read', 'search'] }]);
    const args: z.infer<typeof AuditLogQuerySchema> = {};
    await expect(handleAuditLog(args, ctx)).rejects.toThrow(PermissionDeniedError);
  });

  it('caps limit at 1000 even when caller asks for more', async () => {
    // Schema validation should clamp/reject; assert the schema does so.
    const parsed = AuditLogQuerySchema.safeParse({ limit: 5000 });
    expect(parsed.success).toBe(false);
  });

  it('feeds rows logged by logExecAudit (round-trip with the real writer)', async () => {
    logExecAudit(db, {
      caller: 'agent-a',
      command: 'fresh',
      working_dir: '/x',
      stdout: 'ok',
      stderr: '',
      exit_code: 0,
    });
    const ctx = buildContext(adminScopes);
    const args: z.infer<typeof AuditLogQuerySchema> = { command_pattern: 'fresh' };
    const result = await handleAuditLog(args, ctx) as {
      entries: Array<{ command: string }>;
      total: number;
    };
    expect(result.total).toBe(1);
    expect(result.entries[0].command).toBe('fresh');
  });
});
