// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { ResolvedAuthConfig, ResolvedOAuthProvider, ResolvedRbacConfig } from '../shared/types.js';
import { parseBearerToken } from './http-auth.js';
import { resolveScopes, type IdentityFacts } from './roles.js';
import type { AuthBackend, AuthOutcome, DiscoveryDocument } from './auth-backend.js';

/** Resolver from `jose` (or a test stub) that supplies the verification key. */
export type JwksResolver = JWTVerifyGetKey;

/** Coerce an OIDC claim into a string array (array, space-delimited, or scalar). */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
  return [];
}

/**
 * Reduce a verified token payload to the identity facts the RBAC resolver
 * consumes, per a provider's claim mapping.
 */
export function extractIdentityFacts(
  payload: JWTPayload,
  provider: ResolvedOAuthProvider,
): IdentityFacts | null {
  const rawSubject = payload[provider.subject_claim] ?? payload.sub;
  if (typeof rawSubject !== 'string' || rawSubject.length === 0) return null;

  const facts: IdentityFacts = { subject: rawSubject };
  if (provider.groups_claim) facts.groups = toStringArray(payload[provider.groups_claim]);
  if (provider.roles_claim) facts.roles = toStringArray(payload[provider.roles_claim]);
  if (provider.domain_claim && typeof payload[provider.domain_claim] === 'string') {
    facts.domain = payload[provider.domain_claim] as string;
  }
  return facts;
}

/**
 * Compute the RFC 9728 protected-resource-metadata path for a resource URL.
 * The well-known segment is prefixed and the resource's path (if any) is
 * appended, matching what MCP clients derive from the server URL:
 *   https://host/mcp → /.well-known/oauth-protected-resource/mcp
 *   https://host/    → /.well-known/oauth-protected-resource
 */
export function protectedResourceMetadataPath(resource: string): string {
  const url = new URL(resource);
  const suffix = url.pathname === '/' ? '' : url.pathname;
  return `/.well-known/oauth-protected-resource${suffix}`;
}

/**
 * OAuth 2.1 Resource Server backend. Validates incoming JWT access tokens
 * against one or more trusted providers (any may authenticate a request),
 * then maps the verified identity to scopes via the RBAC policy.
 */
export class OAuthExternalBackend implements AuthBackend {
  private readonly resolvers: Array<JwksResolver | undefined>;

  constructor(
    private readonly auth: ResolvedAuthConfig,
    private readonly rbac: ResolvedRbacConfig | undefined,
    private readonly realm: string,
    opts?: {
      /** Test/override hook: supply the JWKS resolver per provider index. */
      jwksFor?: (provider: ResolvedOAuthProvider, index: number) => JwksResolver;
    },
  ) {
    this.resolvers = auth.providers.map((p, i) =>
      opts?.jwksFor ? opts.jwksFor(p, i) : undefined,
    );
  }

  challenge(): string {
    let value = `Bearer realm="${this.realm}"`;
    if (this.auth.resource) {
      const origin = new URL(this.auth.resource).origin;
      const metadataUrl = origin + protectedResourceMetadataPath(this.auth.resource);
      value += `, resource_metadata="${metadataUrl}"`;
    }
    return value;
  }

  discovery(): DiscoveryDocument[] {
    if (!this.auth.resource) return [];
    const body = {
      resource: this.auth.resource,
      authorization_servers: [...new Set(this.auth.providers.map((p) => p.issuer))],
      bearer_methods_supported: ['header'],
      resource_name: this.realm,
    };
    // Serve both the path-suffixed form (what clients derive from a resource
    // with a path) and the bare form, so discovery resolves either way.
    const docs: DiscoveryDocument[] = [
      { path: protectedResourceMetadataPath(this.auth.resource), body },
    ];
    if (!docs.some((d) => d.path === '/.well-known/oauth-protected-resource')) {
      docs.push({ path: '/.well-known/oauth-protected-resource', body });
    }
    return docs;
  }

  /** Lazily build (and cache) the JWKS resolver for a provider. */
  private resolverFor(provider: ResolvedOAuthProvider, index: number): JwksResolver {
    const existing = this.resolvers[index];
    if (existing) return existing;
    const jwksUri = provider.jwks_uri
      ?? `${provider.issuer.replace(/\/$/, '')}/.well-known/jwks.json`;
    const resolver = createRemoteJWKSet(new URL(jwksUri));
    this.resolvers[index] = resolver;
    return resolver;
  }

  async authenticate(authHeader: string | undefined): Promise<AuthOutcome> {
    if (authHeader === undefined) return { ok: false, status: 401, reason: 'missing' };
    const token = parseBearerToken(authHeader);
    if (token === null) return { ok: false, status: 401, reason: 'malformed' };

    for (let i = 0; i < this.auth.providers.length; i++) {
      const provider = this.auth.providers[i];
      let payload: JWTPayload;
      try {
        const resolver = this.resolverFor(provider, i);
        const result = await jwtVerify(token, resolver, {
          issuer: provider.issuer,
          audience: provider.audience,
          algorithms: provider.algorithms,
        });
        payload = result.payload;
      } catch {
        // Wrong issuer / bad signature / expired for this provider — the token
        // may belong to another configured provider, so try the next.
        continue;
      }

      // A valid signature for this provider settles which IdP minted the token;
      // we do not fall through to others after this point.
      const facts = extractIdentityFacts(payload, provider);
      if (!facts) return { ok: false, status: 401, reason: 'missing_subject_claim' };

      const access = resolveScopes(facts, this.rbac ?? EMPTY_RBAC);
      if (access.scopes.length === 0) {
        // Authenticated, but the RBAC policy grants nothing — a 403, distinct
        // from an authentication failure.
        return { ok: false, status: 403, reason: 'no_grants' };
      }
      return { ok: true, caller: { id: facts.subject, scopes: access.scopes } };
    }

    return { ok: false, status: 401, reason: 'invalid_token' };
  }
}

const EMPTY_RBAC: ResolvedRbacConfig = {
  roles: {},
  local_groups: {},
  bindings: [],
  default_role: null,
};
