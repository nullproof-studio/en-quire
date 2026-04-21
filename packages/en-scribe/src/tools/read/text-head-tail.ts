// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import {
  readDocument,
  resolveFilePath,
  computeEtag,
  requirePermission,
  readLineRange,
  countLines,
} from '@nullproof-studio/en-core';

/**
 * text_head and text_tail — one-shot shortcuts for reading the first or last
 * N lines of a file. Equivalent to `text_read` + manual line-math, but cheap
 * enough to justify two dedicated tools because agents reach for `tail` and
 * `head` semantics constantly, especially on .log files.
 *
 * When the file has fewer lines than requested, both return the whole file
 * rather than padding or erroring — matches GNU head/tail behaviour.
 */

const DEFAULT_LINES = 10;

export const TextHeadSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.log").'),
  lines: z.number().int().positive().optional().default(DEFAULT_LINES).describe(`Number of leading lines to return. Default ${DEFAULT_LINES}. If the file has fewer lines, returns the whole file.`),
});

export const TextTailSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.log").'),
  lines: z.number().int().positive().optional().default(DEFAULT_LINES).describe(`Number of trailing lines to return. Default ${DEFAULT_LINES}. If the file has fewer lines, returns the whole file.`),
});

export async function handleTextHead(
  args: z.infer<typeof TextHeadSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const resolved = resolveFilePath(ctx.config.document_roots, args.file);
  const { content } = readDocument(resolved.root.path, resolved.relativePath);
  const etag = computeEtag(content);
  const totalLines = countLines(content);

  if (totalLines === 0) {
    return { content: '', etag, line_start: 0, line_end: 0, total_lines: 0 };
  }

  const endLine = Math.min(args.lines, totalLines);
  const excerpt = readLineRange(content, 1, endLine);
  return {
    content: excerpt,
    etag,
    line_start: 1,
    line_end: endLine,
    total_lines: totalLines,
  };
}

export async function handleTextTail(
  args: z.infer<typeof TextTailSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const resolved = resolveFilePath(ctx.config.document_roots, args.file);
  const { content } = readDocument(resolved.root.path, resolved.relativePath);
  const etag = computeEtag(content);
  const totalLines = countLines(content);

  if (totalLines === 0) {
    return { content: '', etag, line_start: 0, line_end: 0, total_lines: 0 };
  }

  const startLine = Math.max(1, totalLines - args.lines + 1);
  const excerpt = readLineRange(content, startLine, totalLines);
  return {
    content: excerpt,
    etag,
    line_start: startLine,
    line_end: totalLines,
    total_lines: totalLines,
  };
}
