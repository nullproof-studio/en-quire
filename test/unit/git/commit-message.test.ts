// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { buildCommitMessage, buildProposalBranch } from '../../../src/git/commit-message.js';

describe('buildCommitMessage', () => {
  it('builds a structured commit message', () => {
    const msg = buildCommitMessage({
      operation: 'Replace section',
      target: '2.7 Checks',
      file: 'sops/deployment.md',
      caller: 'michelle',
      mode: 'write',
    });

    expect(msg).toContain('[en-quire] Replace section "2.7 Checks" in sops/deployment.md');
    expect(msg).toContain('Caller: michelle');
    expect(msg).toContain('Operation: Replace section');
    expect(msg).toContain('Mode: write');
  });

  it('includes user message when provided', () => {
    const msg = buildCommitMessage({
      operation: 'Append',
      target: 'Overview',
      file: 'docs/readme.md',
      caller: 'bot',
      mode: 'propose',
      userMessage: 'Added new requirement',
    });

    expect(msg).toContain('Message: Added new requirement');
    expect(msg).toContain('Mode: propose');
  });
});

describe('buildProposalBranch', () => {
  it('builds a branch name with expected format', () => {
    const branch = buildProposalBranch('michelle', 'skills/triage-agent.md');
    expect(branch).toMatch(/^propose\/michelle\/skills\/triage-agent\/\d{8}T\d{4}\d{2}Z$/);
  });
});
