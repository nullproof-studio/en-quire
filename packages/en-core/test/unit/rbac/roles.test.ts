// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { resolveScopes } from '@nullproof-studio/en-core';
import type { RbacConfig, IdentityFacts } from '@nullproof-studio/en-core';

const ROLES = {
  admin: [{ path: '**', permissions: ['read', 'search', 'write', 'propose', 'approve'] as const }],
  editor: [{ path: 'sops/**', permissions: ['read', 'search', 'propose'] as const }],
  reader: [{ path: '**', permissions: ['read', 'search'] as const }],
};

function rbac(partial: Partial<RbacConfig> = {}): RbacConfig {
  return {
    roles: ROLES,
    local_groups: {},
    bindings: [],
    default_role: null,
    ...partial,
  };
}

describe('resolveScopes', () => {
  it('matches an idp_group binding and expands the role to scopes', () => {
    const cfg = rbac({ bindings: [{ idp_group: 'docs-editors', roles: ['editor'] }] });
    const facts: IdentityFacts = { subject: 'a@example.com', groups: ['docs-editors'] };
    const out = resolveScopes(facts, cfg);
    expect(out.roles).toEqual(['editor']);
    expect(out.scopes).toEqual(ROLES.editor);
  });

  it('matches an idp_role binding', () => {
    const cfg = rbac({ bindings: [{ idp_role: 'Admin', roles: ['admin'] }] });
    const out = resolveScopes({ subject: 'a@example.com', roles: ['Admin'] }, cfg);
    expect(out.roles).toEqual(['admin']);
  });

  it('matches an explicit user binding (case-insensitive)', () => {
    const cfg = rbac({ bindings: [{ user: 'Andy@Example.com', roles: ['admin'] }] });
    const out = resolveScopes({ subject: 'andy@example.com' }, cfg);
    expect(out.roles).toEqual(['admin']);
  });

  it('matches a domain binding case-insensitively', () => {
    const cfg = rbac({ bindings: [{ domain: 'Example.com', roles: ['editor'] }] });
    const out = resolveScopes({ subject: 'x@example.com', domain: 'example.com' }, cfg);
    expect(out.roles).toEqual(['editor']);
  });

  it('matches a local_group binding when the subject is a member', () => {
    const cfg = rbac({
      local_groups: { editors: ['Alice@Gmail.com', 'bob@gmail.com'] },
      bindings: [{ local_group: 'editors', roles: ['editor'] }],
    });
    const out = resolveScopes({ subject: 'alice@gmail.com' }, cfg);
    expect(out.roles).toEqual(['editor']);
  });

  it('does not match a local_group binding for a non-member', () => {
    const cfg = rbac({
      local_groups: { editors: ['alice@gmail.com'] },
      bindings: [{ local_group: 'editors', roles: ['editor'] }],
    });
    const out = resolveScopes({ subject: 'eve@gmail.com' }, cfg);
    expect(out.roles).toEqual([]);
    expect(out.scopes).toEqual([]);
  });

  it('unions roles from multiple matching bindings and dedupes scopes', () => {
    const cfg = rbac({
      bindings: [
        { idp_group: 'g1', roles: ['reader'] },
        { user: 'a@example.com', roles: ['editor'] },
        { idp_group: 'g1', roles: ['reader'] }, // duplicate role
      ],
    });
    const out = resolveScopes({ subject: 'a@example.com', groups: ['g1'] }, cfg);
    expect(out.roles).toEqual(['reader', 'editor']);
    expect(out.scopes).toEqual([...ROLES.reader, ...ROLES.editor]);
  });

  it('falls back to default_role when no binding matches', () => {
    const cfg = rbac({
      default_role: 'reader',
      bindings: [{ idp_group: 'docs-admins', roles: ['admin'] }],
    });
    const out = resolveScopes({ subject: 'nobody@example.com', groups: ['other'] }, cfg);
    expect(out.roles).toEqual(['reader']);
    expect(out.scopes).toEqual(ROLES.reader);
  });

  it('does not apply default_role when a binding already matched', () => {
    const cfg = rbac({
      default_role: 'reader',
      bindings: [{ user: 'a@example.com', roles: ['admin'] }],
    });
    const out = resolveScopes({ subject: 'a@example.com' }, cfg);
    expect(out.roles).toEqual(['admin']);
  });

  it('denies (empty scopes) when nothing matches and no default_role', () => {
    const cfg = rbac({ bindings: [{ idp_group: 'docs-admins', roles: ['admin'] }] });
    const out = resolveScopes({ subject: 'nobody@example.com' }, cfg);
    expect(out.roles).toEqual([]);
    expect(out.scopes).toEqual([]);
  });

  it('skips a matched binding that references an unknown role', () => {
    const cfg = rbac({ bindings: [{ user: 'a@example.com', roles: ['ghost'] }] });
    const out = resolveScopes({ subject: 'a@example.com' }, cfg);
    // role name is recorded as matched, but it contributes no scopes
    expect(out.scopes).toEqual([]);
  });

  it('treats absent groups/roles claims as no membership (no throw)', () => {
    const cfg = rbac({ bindings: [{ idp_group: 'g1', roles: ['editor'] }] });
    const out = resolveScopes({ subject: 'a@example.com' }, cfg);
    expect(out.roles).toEqual([]);
  });
});
