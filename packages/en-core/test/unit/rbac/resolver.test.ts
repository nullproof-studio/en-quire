// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { resolveCaller } from '@nullproof-studio/en-core';
import type { ResolvedConfig } from '@nullproof-studio/en-core';

function baseConfig(partial: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    document_roots: {},
    database: ':memory:',
    transport: 'stdio',
    port: 0,
    search: {
      sync_on_start: 'blocking',
      batch_size: 500,
      semantic: { enabled: false },
    },
    logging: { level: 'info', dir: null },
    callers: {},
    require_read_before_write: false,
    ...partial,
  };
}

describe('resolveCaller', () => {
  it('returns a named caller when one is requested (stdio)', () => {
    const config = baseConfig({
      callers: {
        alice: { scopes: [{ path: '**', permissions: ['read', 'write'] }] },
      },
    });
    const result = resolveCaller(config, 'alice');
    expect(result.id).toBe('alice');
  });

  it('auto-selects the single configured caller on stdio', () => {
    const config = baseConfig({
      callers: {
        solo: { scopes: [{ path: '**', permissions: ['read'] }] },
      },
    });
    const result = resolveCaller(config);
    expect(result.id).toBe('solo');
  });

  it('falls back to _default on stdio when multiple callers exist and none is named', () => {
    const config = baseConfig({
      callers: {
        alice: { scopes: [{ path: '**', permissions: ['read'] }] },
        bob: { scopes: [{ path: '**', permissions: ['read'] }] },
      },
    });
    const result = resolveCaller(config);
    expect(result.id).toBe('_default');
    expect(result.scopes[0].permissions).toEqual(['read', 'search']);
  });

  it('THROWS under HTTP transport when no caller is named — auto-select is unsafe there', () => {
    const config = baseConfig({
      transport: 'streamable-http',
      callers: {
        solo: { key: 'sk-solo', scopes: [{ path: '**', permissions: ['read'] }] },
      },
    });
    expect(() => resolveCaller(config)).toThrow(/HTTP/);
  });

  it('still allows explicit named lookup under HTTP transport (callers can use it internally)', () => {
    const config = baseConfig({
      transport: 'streamable-http',
      callers: {
        alice: { key: 'sk-alice', scopes: [{ path: '**', permissions: ['read'] }] },
      },
    });
    // Not the intended path — HTTP should go through authenticateBearer —
    // but the named-lookup arm still works so this isn't a breaking change
    // for any edge-case caller that already knows the ID.
    const result = resolveCaller(config, 'alice');
    expect(result.id).toBe('alice');
  });
});
