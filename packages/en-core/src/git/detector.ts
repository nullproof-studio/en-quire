// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface GitDetectionResult {
  available: boolean;
  gitDir: string;
}

/**
 * Detect whether a directory is a git repository by checking for .git.
 */
export function detectGit(documentRoot: string): GitDetectionResult {
  const gitDir = join(documentRoot, '.git');
  const available = existsSync(gitDir) && statSync(gitDir).isDirectory();
  return { available, gitDir };
}
