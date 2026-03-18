// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { tokeniseCommand } from '../../../src/tools/admin/doc-exec.js';

describe('tokeniseCommand', () => {
  it('splits simple command', () => {
    expect(tokeniseCommand('git status')).toEqual(['git', 'status']);
  });

  it('handles double-quoted arguments', () => {
    expect(tokeniseCommand('git commit -m "fix: update docs"')).toEqual([
      'git', 'commit', '-m', 'fix: update docs',
    ]);
  });

  it('handles single-quoted arguments', () => {
    expect(tokeniseCommand("echo 'hello world'")).toEqual(['echo', 'hello world']);
  });

  it('handles escaped spaces', () => {
    expect(tokeniseCommand('cat file\\ name.md')).toEqual(['cat', 'file name.md']);
  });

  it('handles mixed quotes', () => {
    expect(tokeniseCommand(`grep -r "can't stop" src/`)).toEqual([
      'grep', '-r', "can't stop", 'src/',
    ]);
  });

  it('handles multiple spaces between args', () => {
    expect(tokeniseCommand('ls   -la   /tmp')).toEqual(['ls', '-la', '/tmp']);
  });

  it('handles empty input', () => {
    expect(tokeniseCommand('')).toEqual([]);
  });

  it('handles single command with no args', () => {
    expect(tokeniseCommand('ls')).toEqual(['ls']);
  });

  it('preserves empty quoted strings', () => {
    expect(tokeniseCommand('echo ""')).toEqual(['echo', '']);
  });

  it('handles escaped quotes inside quotes', () => {
    expect(tokeniseCommand('echo "hello \\"world\\""')).toEqual(['echo', 'hello "world"']);
  });
});
