// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { CallerIdentity, ResolvedConfig } from '../shared/types.js';

/**
 * Resolve caller identity from config and transport context.
 *
 * Intended for **stdio transport only** — stdio is inherently a single
 * process, so a startup-time caller resolution is safe. The HTTP transport
 * must authenticate every request with `authenticateBearer`; see
 * [rbac/http-auth.ts](../rbac/http-auth.ts).
 *
 * Resolution order (stdio):
 * 1. If a caller ID is provided, match it exactly.
 * 2. If only one caller is configured, use it as default.
 * 3. Fall back to a synthetic `_default` caller with read+search only.
 *
 * If called when `config.transport === 'streamable-http'` without a
 * `callerId`, throws — the single-caller fallback is a serious security
 * hole under HTTP (any request would inherit full permissions).
 */
export function resolveCaller(
  config: ResolvedConfig,
  callerId?: string,
): CallerIdentity {
  if (config.transport === 'streamable-http' && !callerId) {
    throw new Error(
      'resolveCaller() auto-select is not safe under HTTP transport. ' +
      'Use authenticateBearer() on each request instead.',
    );
  }

  const callerEntries = Object.entries(config.callers);

  // If a specific caller is requested, find it
  if (callerId) {
    const entry = config.callers[callerId];
    if (entry) {
      return {
        id: callerId,
        scopes: entry.scopes,
      };
    }
  }

  // If only one caller configured, use it as default (stdio only —
  // the HTTP guard above already returned for that path).
  if (callerEntries.length === 1) {
    const [id, entry] = callerEntries[0];
    return {
      id,
      scopes: entry.scopes,
    };
  }

  // Default caller with minimal permissions
  return {
    id: '_default',
    scopes: [{
      path: '**',
      permissions: ['read', 'search'],
    }],
  };
}
