// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import {
  wrapHandler,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '@nullproof-studio/en-core';
import type { ToolContext } from '@nullproof-studio/en-core';

const ctx = {} as ToolContext;

async function runAndParse<T>(
  handler: (args: T, ctx: ToolContext) => Promise<unknown>,
  args: T,
): Promise<{ isError?: boolean; payload: Record<string, unknown> }> {
  const wrapped = wrapHandler<T>('test_tool', ctx, handler);
  const result = await wrapped(args);
  const text = result.content[0].text;
  return { isError: result.isError, payload: JSON.parse(text) };
}

describe('wrapHandler error serialization', () => {
  it('spreads candidates from NotFoundError into the JSON payload', async () => {
    const { isError, payload } = await runAndParse(async () => {
      throw new NotFoundError('root', 'docz/file.md', ['docs', 'dogs', 'memory'], 'Prefix the path.');
    }, {});
    expect(isError).toBe(true);
    expect(payload.error).toBe('not_found');
    expect(payload.candidates).toEqual(['docs', 'dogs', 'memory']);
    expect(payload.message).toContain('Prefix the path.');
    expect(payload.message).toContain('Did you mean: docs, dogs, memory?');
  });

  it('omits candidates when the error has none', async () => {
    const { payload } = await runAndParse(async () => {
      throw new ValidationError('bad input');
    }, {});
    expect(payload.error).toBe('validation_error');
    expect(payload).not.toHaveProperty('candidates');
  });

  it('still spreads current_etag from PreconditionFailedError', async () => {
    const { payload } = await runAndParse(async () => {
      throw new PreconditionFailedError('docs/foo.md', 'etag-123', 'stale');
    }, {});
    expect(payload.current_etag).toBe('etag-123');
  });
});
