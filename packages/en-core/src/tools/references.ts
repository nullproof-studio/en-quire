// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { checkPermission, requirePermission } from '../rbac/permissions.js';

/**
 * Cross-document reference queries over the doc_links index.
 *
 * `doc_references(file, section?)` answers "what does this section/file
 * point to?" — outgoing edges in the link graph.
 *
 * `doc_referenced_by(file, section?)` answers the inverse — incoming
 * edges. This is the impact-analysis primitive: before modifying a shared
 * SOP section, callers can ask which skills and runbooks point at it.
 *
 * Both tools require `read` permission on the queried file. They do not
 * dereference targets, so cross-root permission isn't relevant — the
 * caller only sees that a link exists, not what's behind it.
 */

export interface ReferenceEntry {
  target_file: string;
  target_section: string | null;
  relationship: string;
  context: string | null;
  source_section?: string | null;
}

export interface InverseReferenceEntry {
  source_file: string;
  source_section: string | null;
  relationship: string;
  context: string | null;
  target_section?: string | null;
}

export const ReferencesSchema = z.object({
  file: z.string().describe('Root-prefixed path of the source file (e.g. "docs/sops/runbook.md").'),
  section: z.string().optional().describe(
    'Optional source section path ("Top > Foo > Bar"). When omitted, returns links from anywhere in the file.',
  ),
});

export const ReferencedBySchema = z.object({
  file: z.string().describe('Root-prefixed path of the target file (e.g. "docs/sops/runbook.md").'),
  section: z.string().optional().describe(
    'Optional target section. When provided, only links pointing at that section are returned.',
  ),
});

export async function handleReferences(
  args: z.infer<typeof ReferencesSchema>,
  ctx: ToolContext,
): Promise<{ references: ReferenceEntry[] }> {
  requirePermission(ctx.caller, 'read', args.file);

  const where: string[] = ['source_file = ?'];
  const params: unknown[] = [args.file];
  if (args.section !== undefined) {
    where.push('source_section = ?');
    params.push(args.section);
  }

  const rows = ctx.db.prepare(
    `SELECT source_section, target_file, target_section, relationship, context
     FROM doc_links
     WHERE ${where.join(' AND ')}
     ORDER BY id`,
  ).all(...params) as Array<{
    source_section: string | null;
    target_file: string;
    target_section: string | null;
    relationship: string;
    context: string | null;
  }>;

  const references: ReferenceEntry[] = rows.map((r) => ({
    target_file: r.target_file,
    target_section: r.target_section,
    relationship: r.relationship,
    context: r.context,
    source_section: r.source_section,
  }));
  return { references };
}

export async function handleReferencedBy(
  args: z.infer<typeof ReferencedBySchema>,
  ctx: ToolContext,
): Promise<{ referenced_by: InverseReferenceEntry[] }> {
  requirePermission(ctx.caller, 'read', args.file);

  const where: string[] = ['target_file = ?'];
  const params: unknown[] = [args.file];
  if (args.section !== undefined) {
    where.push('target_section = ?');
    params.push(args.section);
  }

  const rows = ctx.db.prepare(
    `SELECT source_file, source_section, target_section, relationship, context
     FROM doc_links
     WHERE ${where.join(' AND ')}
     ORDER BY id`,
  ).all(...params) as Array<{
    source_file: string;
    source_section: string | null;
    target_section: string | null;
    relationship: string;
    context: string | null;
  }>;

  // Filter to rows whose `source_file` the caller can also read. Inverse
  // references leak two things otherwise: the existence and path of source
  // files the caller can't see, and the `context` snippet which is taken
  // from the source file's body. `read` on the target file is not
  // sufficient — the source side has its own permission boundary.
  const referenced_by: InverseReferenceEntry[] = rows
    .filter((r) => checkPermission(ctx.caller, 'read', r.source_file).allowed)
    .map((r) => ({
      source_file: r.source_file,
      source_section: r.source_section,
      relationship: r.relationship,
      context: r.context,
      target_section: r.target_section,
    }));
  return { referenced_by };
}
