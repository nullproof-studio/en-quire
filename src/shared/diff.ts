// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { createTwoFilesPatch } from 'diff';

/**
 * Generate a unified diff between two versions of a file's content.
 */
export function generateDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
): string {
  return createTwoFilesPatch(
    `a/${filePath}`,
    `b/${filePath}`,
    oldContent,
    newContent,
    undefined,
    undefined,
    { context: 3 },
  );
}
