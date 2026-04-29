// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import { createHmac } from 'node:crypto';
import { simpleGit, type SimpleGit } from 'simple-git';
import { GitOperations } from '@nullproof-studio/en-core';

interface CapturedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let repoDir: string;
let server: Server;
let port: number;
let captured: CapturedRequest[];
let nextResponseStatus: number;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

beforeEach(async () => {
  repoDir = mkdtempSync(join(tmpdir(), 'pr-hook-webhook-'));
  const g: SimpleGit = simpleGit(repoDir);
  await g.init();
  await g.addConfig('user.email', 'test@example.com');
  await g.addConfig('user.name', 'Test');
  await g.addConfig('commit.gpgsign', 'false');
  await g.raw(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  writeFileSync(join(repoDir, 'README'), 'base\n');
  await g.add('README');
  await g.commit('init');

  captured = [];
  nextResponseStatus = 200;
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    captured.push({
      method: req.method ?? '',
      path: req.url ?? '',
      headers: req.headers,
      body,
    });
    res.statusCode = nextResponseStatus;
    res.end('ok');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(repoDir, { recursive: true, force: true });
});

describe('GitOperations.runPrHook — webhook mode', () => {
  it('treats an http:// pr_hook value as a webhook and POSTs JSON', async () => {
    const url = `http://127.0.0.1:${port}/hook`;
    const ops = new GitOperations(repoDir, null, null, null, false, url, null);
    const result = await ops.runPrHook({ branch: 'propose/m/a.md/20260429T000000Z', file: 'a.md', caller: 'michelle' });

    expect(result.ran).toBe(true);
    expect(result.warning).toBeUndefined();

    expect(captured).toHaveLength(1);
    const req = captured[0];
    expect(req.method).toBe('POST');
    expect(req.path).toBe('/hook');
    expect(req.headers['content-type']).toMatch(/application\/json/);

    const body = JSON.parse(req.body) as {
      branch: string;
      file: string;
      caller: string;
      timestamp: string;
    };
    expect(body.branch).toBe('propose/m/a.md/20260429T000000Z');
    expect(body.file).toBe('a.md');
    expect(body.caller).toBe('michelle');
    // ISO 8601 timestamp from Date.toISOString
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('signs the body with HMAC-SHA256 when pr_hook_secret is configured', async () => {
    const secret = 'shared-secret-abc';
    const url = `http://127.0.0.1:${port}/hook`;
    const ops = new GitOperations(repoDir, null, null, null, false, url, secret);

    const result = await ops.runPrHook({ branch: 'b', file: 'f.md', caller: 'c' });
    expect(result.ran).toBe(true);

    const req = captured[0];
    const sigHeader = req.headers['x-enquire-signature'];
    expect(typeof sigHeader).toBe('string');
    expect(sigHeader).toMatch(/^sha256=[0-9a-f]{64}$/);

    const expected = 'sha256=' + createHmac('sha256', secret).update(req.body).digest('hex');
    expect(sigHeader).toBe(expected);
  });

  it('omits the signature header when no pr_hook_secret is set', async () => {
    const url = `http://127.0.0.1:${port}/hook`;
    const ops = new GitOperations(repoDir, null, null, null, false, url, null);
    const result = await ops.runPrHook({ branch: 'b', file: 'f.md', caller: 'c' });
    expect(result.ran).toBe(true);
    expect(captured[0].headers['x-enquire-signature']).toBeUndefined();
  });

  it('returns ran:false with a warning on non-2xx response (does not throw)', async () => {
    nextResponseStatus = 500;
    const url = `http://127.0.0.1:${port}/hook`;
    const ops = new GitOperations(repoDir, null, null, null, false, url, null);
    const result = await ops.runPrHook({ branch: 'b', file: 'f.md', caller: 'c' });
    expect(result.ran).toBe(false);
    expect(result.warning).toBeDefined();
    expect(result.warning).toMatch(/500/);
  });

  it('returns ran:false with a warning when the URL is unreachable (does not throw)', async () => {
    // Free a port and point at it — connection refused
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const url = `http://127.0.0.1:${port}/hook`;
    const ops = new GitOperations(repoDir, null, null, null, false, url, null);
    const result = await ops.runPrHook({ branch: 'b', file: 'f.md', caller: 'c' });
    expect(result.ran).toBe(false);
    expect(result.warning).toBeDefined();
    // Restart so afterEach can close cleanly
    server = createServer((_req, res) => res.end('ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  });

  it('still runs commands when the value is not a URL (backwards-compatible)', async () => {
    // A relative-looking string is a command, not a webhook
    const ops = new GitOperations(repoDir, null, null, null, false, 'true', null);
    const result = await ops.runPrHook({ branch: 'b', file: 'f.md', caller: 'c' });
    expect(result.ran).toBe(true);
    // No HTTP request was made
    expect(captured).toHaveLength(0);
  });
});
