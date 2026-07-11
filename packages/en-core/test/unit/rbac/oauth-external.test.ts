// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet, type JWK } from 'jose';
import {
  OAuthExternalBackend,
  extractIdentityFacts,
  protectedResourceMetadataPath,
} from '@nullproof-studio/en-core';
import type {
  ResolvedAuthConfig,
  ResolvedRbacConfig,
  ResolvedOAuthProvider,
} from '@nullproof-studio/en-core';

const ISSUER = 'https://idp.example.com/';
const RESOURCE = 'https://docs.example.com/mcp';
const AUDIENCE = RESOURCE;

let privateKey: CryptoKey;
let publicJwk: JWK;
// A second provider's keypair, for the multi-provider test.
let privateKey2: CryptoKey;
let publicJwk2: JWK;

beforeAll(async () => {
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey as CryptoKey;
  publicJwk = { ...(await exportJWK(kp.publicKey)), alg: 'RS256', use: 'sig', kid: 'k1' };

  const kp2 = await generateKeyPair('RS256');
  privateKey2 = kp2.privateKey as CryptoKey;
  publicJwk2 = { ...(await exportJWK(kp2.publicKey)), alg: 'RS256', use: 'sig', kid: 'k2' };
});

function provider(partial: Partial<ResolvedOAuthProvider> = {}): ResolvedOAuthProvider {
  return {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['RS256'],
    subject_claim: 'email',
    groups_claim: 'groups',
    domain_claim: 'hd',
    ...partial,
  };
}

const RBAC: ResolvedRbacConfig = {
  roles: {
    editor: [{ path: 'sops/**', permissions: ['read', 'search', 'propose'] }],
    reader: [{ path: '**', permissions: ['read', 'search'] }],
  },
  local_groups: {},
  bindings: [
    { idp_group: 'docs-editors', roles: ['editor'] },
    { domain: 'example.com', roles: ['reader'] },
  ],
  default_role: null,
};

function backend(
  auth: Partial<ResolvedAuthConfig> = {},
  rbac: ResolvedRbacConfig = RBAC,
  jwksByIndex: JWK[] = [publicJwk],
) {
  const resolved: ResolvedAuthConfig = {
    mode: 'oauth-external',
    resource: RESOURCE,
    providers: [provider()],
    ...auth,
  };
  return new OAuthExternalBackend(resolved, rbac, 'en-quire', {
    jwksFor: (_p, i) => createLocalJWKSet({ keys: [jwksByIndex[i]] }),
  });
}

async function sign(
  claims: Record<string, unknown>,
  opts: { iss?: string; aud?: string; exp?: string | number; key?: CryptoKey } = {},
): Promise<string> {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: claims.kid as string ?? 'k1' })
    .setIssuedAt()
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setExpirationTime(opts.exp ?? '2h');
  return jwt.sign(opts.key ?? privateKey);
}

describe('protectedResourceMetadataPath', () => {
  it('appends the resource path to the well-known segment', () => {
    expect(protectedResourceMetadataPath('https://docs.example.com/mcp'))
      .toBe('/.well-known/oauth-protected-resource/mcp');
  });
  it('omits the suffix for a root resource', () => {
    expect(protectedResourceMetadataPath('https://docs.example.com/'))
      .toBe('/.well-known/oauth-protected-resource');
  });
});

describe('extractIdentityFacts', () => {
  it('maps subject/groups/domain claims', () => {
    const facts = extractIdentityFacts(
      { email: 'a@example.com', groups: ['g1', 'g2'], hd: 'example.com' },
      provider(),
    );
    expect(facts).toEqual({ subject: 'a@example.com', groups: ['g1', 'g2'], domain: 'example.com' });
  });
  it('splits a space-delimited roles claim', () => {
    const facts = extractIdentityFacts(
      { email: 'a@example.com', roles: 'admin editor' },
      provider({ roles_claim: 'roles' }),
    );
    expect(facts?.roles).toEqual(['admin', 'editor']);
  });
  it('returns null when the subject claim is absent', () => {
    expect(extractIdentityFacts({ groups: ['g1'] }, provider())).toBeNull();
  });
});

describe('OAuthExternalBackend.authenticate', () => {
  it('authenticates a valid token and maps groups to scopes', async () => {
    const token = await sign({ email: 'a@example.com', groups: ['docs-editors'] });
    const out = await backend().authenticate(`Bearer ${token}`);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.caller.id).toBe('a@example.com');
      expect(out.caller.scopes).toEqual(RBAC.roles.editor);
    }
  });

  it('maps a domain (hd) claim to a role', async () => {
    const token = await sign({ email: 'x@example.com', hd: 'example.com' });
    const out = await backend().authenticate(`Bearer ${token}`);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.caller.scopes).toEqual(RBAC.roles.reader);
  });

  it('rejects a missing Authorization header with 401', async () => {
    const out = await backend().authenticate(undefined);
    expect(out).toEqual({ ok: false, status: 401, reason: 'missing' });
  });

  it('rejects a malformed Authorization header with 401', async () => {
    const out = await backend().authenticate('Basic abc');
    expect(out).toMatchObject({ ok: false, status: 401, reason: 'malformed' });
  });

  it('rejects an expired token with 401 invalid_token', async () => {
    const token = await sign(
      { email: 'a@example.com', groups: ['docs-editors'] },
      { exp: Math.floor(Date.now() / 1000) - 3600 },
    );
    const out = await backend().authenticate(`Bearer ${token}`);
    expect(out).toMatchObject({ ok: false, status: 401, reason: 'invalid_token' });
  });

  it('rejects a token with the wrong audience', async () => {
    const token = await sign({ email: 'a@example.com', groups: ['docs-editors'] }, { aud: 'someone-else' });
    const out = await backend().authenticate(`Bearer ${token}`);
    expect(out.ok).toBe(false);
  });

  it('rejects a token with an untrusted issuer', async () => {
    const token = await sign({ email: 'a@example.com', groups: ['docs-editors'] }, { iss: 'https://evil.example.com/' });
    const out = await backend().authenticate(`Bearer ${token}`);
    expect(out.ok).toBe(false);
  });

  it('returns 403 when authenticated but the policy grants nothing', async () => {
    const token = await sign({ email: 'nobody@other.com', groups: ['unmapped'] });
    const out = await backend().authenticate(`Bearer ${token}`);
    expect(out).toMatchObject({ ok: false, status: 403, reason: 'no_grants' });
  });

  it('authenticates against the second of multiple providers', async () => {
    const auth: Partial<ResolvedAuthConfig> = {
      providers: [provider({ issuer: 'https://first.example.com/' }), provider({ issuer: ISSUER })],
    };
    // index 0 → first provider's (unused) key; index 1 → our signing key
    const b = backend(auth, RBAC, [publicJwk2, publicJwk]);
    const token = await sign({ email: 'a@example.com', groups: ['docs-editors'] });
    const out = await b.authenticate(`Bearer ${token}`);
    expect(out.ok).toBe(true);
  });
});

describe('OAuthExternalBackend discovery + challenge', () => {
  it('advertises protected-resource metadata pointing at the issuer', () => {
    const docs = backend().discovery();
    const doc = docs.find((d) => d.path === '/.well-known/oauth-protected-resource/mcp');
    expect(doc).toBeDefined();
    expect(doc!.body).toMatchObject({
      resource: RESOURCE,
      authorization_servers: [ISSUER],
    });
  });

  it('includes resource_metadata in the WWW-Authenticate challenge', () => {
    expect(backend().challenge()).toContain(
      'resource_metadata="https://docs.example.com/.well-known/oauth-protected-resource/mcp"',
    );
  });
});
