// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { CallerConfig, CallerIdentity, ResolvedConfig } from '../shared/types.js';
import { authenticateBearer } from './http-auth.js';
import { OAuthExternalBackend } from './oauth-external.js';

/**
 * Outcome of authenticating a single HTTP request. On failure the backend
 * names the HTTP status and a short machine reason; the transport renders the
 * response and attaches the backend's `challenge()` as `WWW-Authenticate`.
 *
 * Status distinguishes two failure classes:
 *   401 — not authenticated (no/invalid credential)
 *   403 — authenticated but authorised for nothing (known identity, no scopes)
 */
export type AuthOutcome =
  | { ok: true; caller: CallerIdentity }
  | { ok: false; status: 401 | 403; reason: string };

/** A `.well-known` discovery document served as a GET JSON response. */
export interface DiscoveryDocument {
  path: string;
  body: unknown;
}

/**
 * Pluggable authentication backend. Every transport-facing request is reduced
 * to a `CallerIdentity` (or a failure) here, so the HTTP server is agnostic to
 * whether auth is a static bearer key or a full OAuth token validation.
 */
export interface AuthBackend {
  /** Authenticate from the raw `Authorization` header value. */
  authenticate(authHeader: string | undefined): Promise<AuthOutcome>;
  /** Full `WWW-Authenticate` header value to emit on a 401. */
  challenge(): string;
  /** Discovery documents to serve as GET JSON (empty for bearer). */
  discovery(): DiscoveryDocument[];
}

/**
 * Static pre-shared-key backend — the original behaviour. Matches
 * `Authorization: Bearer <token>` against the configured caller keys.
 */
export class BearerAuthBackend implements AuthBackend {
  constructor(
    private readonly callers: Record<string, CallerConfig>,
    private readonly realm: string,
  ) {}

  challenge(): string {
    return `Bearer realm="${this.realm}"`;
  }

  discovery(): DiscoveryDocument[] {
    return [];
  }

  async authenticate(authHeader: string | undefined): Promise<AuthOutcome> {
    const r = authenticateBearer(authHeader, this.callers);
    if (r.ok) return { ok: true, caller: r.caller };
    return { ok: false, status: 401, reason: r.reason };
  }
}

/**
 * Build the auth backend selected by `config.auth.mode`. Defaults to bearer
 * when no `auth` block is present, preserving backward compatibility.
 */
export function createAuthBackend(config: ResolvedConfig, realm: string): AuthBackend {
  const mode = config.auth?.mode ?? 'bearer';
  switch (mode) {
    case 'oauth-external':
      if (!config.auth?.resource || !config.auth.providers.length) {
        // The loader already guards this, but a hand-built config could reach
        // here — fail clearly rather than constructing a useless backend.
        throw new Error('oauth-external requires auth.resource and at least one provider.');
      }
      return new OAuthExternalBackend(config.auth, config.rbac, realm);
    case 'bearer':
    default:
      return new BearerAuthBackend(config.callers, realm);
  }
}
