// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '@nullproof-studio/en-core';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rbac-cfg-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(yaml: string): string {
  const path = join(dir, 'config.yaml');
  writeFileSync(path, yaml);
  return path;
}

const VALID = `
document_roots:
  notes:
    path: .
transport: stdio
rbac:
  roles:
    admin:
      - path: "**"
        permissions: [read, search, write, propose, approve]
    editor:
      - path: "sops/**"
        permissions: [read, search, propose]
  local_groups:
    team: [alice@example.com, bob@example.com]
  bindings:
    - idp_group: docs-admins
      roles: [admin]
    - local_group: team
      roles: [editor]
    - user: andy@example.com
      roles: [admin]
  default_role: editor
`;

describe('loadConfig — RBAC policy', () => {
  it('loads a valid rbac block and exposes it on the resolved config', () => {
    const config = loadConfig(writeConfig(VALID));
    expect(config.rbac).toBeDefined();
    expect(Object.keys(config.rbac!.roles).sort()).toEqual(['admin', 'editor']);
    expect(config.rbac!.bindings).toHaveLength(3);
    expect(config.rbac!.default_role).toBe('editor');
    expect(config.rbac!.local_groups.team).toContain('alice@example.com');
  });

  it('defaults to an empty rbac policy when the block is absent', () => {
    const config = loadConfig(writeConfig(`
document_roots:
  notes:
    path: .
transport: stdio
`));
    expect(config.rbac).toBeDefined();
    expect(config.rbac!.roles).toEqual({});
    expect(config.rbac!.bindings).toEqual([]);
    expect(config.rbac!.default_role).toBeNull();
  });

  it('rejects a binding that references an unknown role', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
rbac:
  roles:
    admin:
      - path: "**"
        permissions: [read]
  bindings:
    - idp_group: g1
      roles: [ghost]
`);
    expect(() => loadConfig(path)).toThrow(/ghost/);
    expect(() => loadConfig(path)).toThrow(/role/i);
  });

  it('rejects a binding with no selector', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
rbac:
  roles:
    admin:
      - path: "**"
        permissions: [read]
  bindings:
    - roles: [admin]
`);
    expect(() => loadConfig(path)).toThrow(/selector/i);
  });

  it('rejects a binding with more than one selector', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
rbac:
  roles:
    admin:
      - path: "**"
        permissions: [read]
  bindings:
    - user: a@example.com
      idp_group: g1
      roles: [admin]
`);
    expect(() => loadConfig(path)).toThrow(/selector/i);
  });

  it('rejects a local_group binding referencing an undefined local_group', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
rbac:
  roles:
    editor:
      - path: "**"
        permissions: [read]
  bindings:
    - local_group: ghosts
      roles: [editor]
`);
    expect(() => loadConfig(path)).toThrow(/ghosts/);
    expect(() => loadConfig(path)).toThrow(/local_group/i);
  });

  it('rejects a default_role that is not a defined role', () => {
    const path = writeConfig(`
document_roots:
  notes:
    path: .
rbac:
  roles:
    admin:
      - path: "**"
        permissions: [read]
  default_role: ghost
`);
    expect(() => loadConfig(path)).toThrow(/default_role/i);
    expect(() => loadConfig(path)).toThrow(/ghost/);
  });
});
