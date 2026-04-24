// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { Logger } from 'winston';
import type { GitOperations } from './operations.js';

/**
 * Run the post-propose side effects — push the branch to the configured
 * remote (if any), then fire the pr_hook (if any) when the push landed.
 *
 * Every path that commits a proposal branch needs this sequence; the
 * shared helper keeps the 6 lifecycle/write tools from drifting out of
 * sync on logging, ordering, and warning handling.
 *
 * Returns an array of warning strings to fold into the tool response.
 * Failures never throw out — the proposal commit has already landed and
 * must not be rolled back by a network or hook hiccup.
 */
export async function runPostProposeHooks(
  git: GitOperations,
  params: { branch: string; file: string; caller: string },
  logger: Logger,
): Promise<string[]> {
  const warnings: string[] = [];

  const pushResult = await git.pushProposalBranch(params.branch);

  if (pushResult.pushed) {
    logger.info('propose:pushed', params);

    const hookResult = await git.runPrHook(params);
    if (hookResult.ran) {
      logger.info('propose:pr-hook-ran', params);
    }
    if (hookResult.warning) {
      logger.warn('propose:pr-hook-failed', { ...params, warning: hookResult.warning });
      warnings.push(hookResult.warning);
    }
  }

  if (pushResult.warning) {
    logger.warn('propose:push-failed', { ...params, warning: pushResult.warning });
    warnings.push(pushResult.warning);
  }

  return warnings;
}
