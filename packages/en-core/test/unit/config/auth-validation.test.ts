// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '@nullproof-studio/en-core';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'auth-cfg-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function writeConfig(yaml: string): string {
  const path = join(dir, 'config.yaml');
  writeFileSync(path, yaml);
  return path;
}

describe('loadConfig — auth backend', () => {
  it('defaults to bearer mode when no auth block is present', () => {
    const config = loadConfig(writeConfig(`
document_roots:
  notes:
    path: .
`));
    expect(config.auth).toBeDefined();
    expect(config.auth!.mode).toBe('bearer');
    expect(config.auth!.providers).toEqual([]);
  });

  it('loads a valid oauth-external block with provider claim mapping', () => {
    const config = loadConfig(writeConfig(`
document_roots:
  notes:
    path: .
auth:
  mode: oauth-external
  resource: "https://docs.example.com/mcp"
  providers:
    - issuer: "https://idp.example.com/"
      audience: "https://docs.example.com/mcp"
      subject_claim: email
      groups_claim: groups
`));
    expect(config.auth!.mode).toBe('oauth-external');
    expect(config.auth!.resource).toBe('https://docs.example.com/mcp');
    expect(config.auth!.providers).toHaveLength(1);
    expect(config.auth!.providers[0].subject_claim).toBe('email');
    expect(config.auth!.providers[0].algorithms).toEqual(['RS256']); // defaulted
  });

  it('rejects oauth-external without a resource', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
auth:
  mode: oauth-external
  providers:
    - issuer: "https://idp.example.com/"
      audience: "aud"
`);
    expect(() => loadConfig(path)).toThrow(/resource/i);
  });

  it('rejects oauth-external with no providers', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
auth:
  mode: oauth-external
  resource: "https://docs.example.com/mcp"
`);
    expect(() => loadConfig(path)).toThrow(/provider/i);
  });

  it('loads provider scopes, defaulting to none', () => {
    const config = loadConfig(writeConfig(`
document_roots:
  notes:
    path: .
auth:
  mode: oauth-external
  resource: "https://docs.example.com/mcp"
  providers:
    - issuer: "https://auth.example.com/realms/example"
      audience: "https://docs.example.com/mcp"
      scopes: ["docs:read", "docs:write"]
    - issuer: "https://idp.example.com/"
      audience: "https://docs.example.com/mcp"
`));
    expect(config.auth!.providers[0].scopes).toEqual(['docs:read', 'docs:write']);
    expect(config.auth!.providers[1].scopes).toEqual([]);
  });

  it('accepts a provider audience that differs from the resource (Entra client id)', () => {
    const config = loadConfig(writeConfig(`
document_roots:
  notes:
    path: .
auth:
  mode: oauth-external
  resource: "https://docs.example.com/mcp"
  providers:
    - issuer: "https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0"
      audience: "66666666-7777-8888-9999-000000000000"
      subject_claim: oid
      roles_claim: roles
      scopes: ["api://66666666-7777-8888-9999-000000000000/docs.read"]
`));
    expect(config.auth!.providers[0].audience).toBe('66666666-7777-8888-9999-000000000000');
  });
});
