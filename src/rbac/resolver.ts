// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { CallerIdentity, ResolvedConfig } from '../shared/types.js';

/**
 * Resolve caller identity from config and transport context.
 *
 * For v0.1 (stdio transport), caller is identified by:
 * 1. If only one caller is configured, use it as default
 * 2. If a caller ID is provided in transport headers, match it
 * 3. Fall back to a default caller with read+search permissions
 */
export function resolveCaller(
  config: ResolvedConfig,
  callerId?: string,
): CallerIdentity {
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

  // If only one caller configured, use it as default
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
