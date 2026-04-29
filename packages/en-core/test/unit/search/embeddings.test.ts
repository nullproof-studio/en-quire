// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import { EmbeddingsClient } from '@nullproof-studio/en-core';

interface CapturedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let server: Server;
let port: number;
let captured: CapturedRequest[];
let nextStatus: number;
let nextResponse: unknown;

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

beforeEach(async () => {
  captured = [];
  nextStatus = 200;
  nextResponse = { data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] };
  server = createServer(async (req, res) => {
    captured.push({
      method: req.method ?? '',
      path: req.url ?? '',
      headers: req.headers,
      body: await readBody(req),
    });
    res.statusCode = nextStatus;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(nextResponse));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
  delete process.env.EN_QUIRE_TEST_KEY;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.EN_QUIRE_TEST_KEY;
});

describe('EmbeddingsClient', () => {
  it('POSTs to {endpoint}/embeddings with the OpenAI body shape', async () => {
    const client = new EmbeddingsClient({
      endpoint: `http://127.0.0.1:${port}/v1`,
      model: 'text-embedding-3-small',
    });
    const out = await client.embed('hello world');

    expect(out).toBeInstanceOf(Float32Array);
    expect(out).toHaveLength(4);
    // Float32 rounds 0.1 → 0.10000000149011612 etc. — compare with tolerance.
    [0.1, 0.2, 0.3, 0.4].forEach((expected, i) => {
      expect(out[i]).toBeCloseTo(expected, 5);
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe('POST');
    expect(captured[0].path).toBe('/v1/embeddings');
    expect(captured[0].headers['content-type']).toMatch(/application\/json/);
    const body = JSON.parse(captured[0].body) as { input: unknown; model: string };
    expect(body.model).toBe('text-embedding-3-small');
    expect(body.input).toBe('hello world');
  });

  it('strips a trailing slash from the endpoint base URL', async () => {
    const client = new EmbeddingsClient({
      endpoint: `http://127.0.0.1:${port}/v1/`,
      model: 'm',
    });
    await client.embed('x');
    expect(captured[0].path).toBe('/v1/embeddings');
  });

  it('sends Authorization: Bearer when api_key is provided', async () => {
    const client = new EmbeddingsClient({
      endpoint: `http://127.0.0.1:${port}/v1`,
      model: 'm',
      api_key: 'sk-literal',
    });
    await client.embed('x');
    expect(captured[0].headers['authorization']).toBe('Bearer sk-literal');
  });

  it('reads api_key from the named environment variable when api_key_env is set', async () => {
    process.env.EN_QUIRE_TEST_KEY = 'sk-from-env';
    const client = new EmbeddingsClient({
      endpoint: `http://127.0.0.1:${port}/v1`,
      model: 'm',
      api_key_env: 'EN_QUIRE_TEST_KEY',
    });
    await client.embed('x');
    expect(captured[0].headers['authorization']).toBe('Bearer sk-from-env');
  });

  it('prefers api_key_env over api_key when both are set', async () => {
    process.env.EN_QUIRE_TEST_KEY = 'sk-env-wins';
    const client = new EmbeddingsClient({
      endpoint: `http://127.0.0.1:${port}/v1`,
      model: 'm',
      api_key: 'sk-config-loser',
      api_key_env: 'EN_QUIRE_TEST_KEY',
    });
    await client.embed('x');
    expect(captured[0].headers['authorization']).toBe('Bearer sk-env-wins');
  });

  it('omits Authorization when no key is configured', async () => {
    const client = new EmbeddingsClient({
      endpoint: `http://127.0.0.1:${port}/v1`,
      model: 'm',
    });
    await client.embed('x');
    expect(captured[0].headers['authorization']).toBeUndefined();
  });

  it('embeds a batch via a single request and returns a Float32Array per input', async () => {
    nextResponse = {
      data: [
        { embedding: [1, 2] },
        { embedding: [3, 4] },
        { embedding: [5, 6] },
      ],
    };
    const client = new EmbeddingsClient({
      endpoint: `http://127.0.0.1:${port}/v1`,
      model: 'm',
    });
    const out = await client.embedBatch(['a', 'b', 'c']);

    expect(captured).toHaveLength(1);
    const body = JSON.parse(captured[0].body) as { input: unknown };
    expect(body.input).toEqual(['a', 'b', 'c']);
    expect(out).toHaveLength(3);
    expect(Array.from(out[0])).toEqual([1, 2]);
    expect(Array.from(out[1])).toEqual([3, 4]);
    expect(Array.from(out[2])).toEqual([5, 6]);
  });

  it('throws on non-2xx response with a useful message', async () => {
    nextStatus = 401;
    nextResponse = { error: { message: 'invalid api key' } };
    const client = new EmbeddingsClient({
      endpoint: `http://127.0.0.1:${port}/v1`,
      model: 'm',
    });
    await expect(client.embed('x')).rejects.toThrow(/401/);
  });

  it('throws when the response payload is malformed', async () => {
    nextResponse = { not_data: 'wrong' };
    const client = new EmbeddingsClient({
      endpoint: `http://127.0.0.1:${port}/v1`,
      model: 'm',
    });
    await expect(client.embed('x')).rejects.toThrow();
  });
});
