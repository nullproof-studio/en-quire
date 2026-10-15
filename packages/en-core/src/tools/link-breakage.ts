// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ToolContext } from './context.js';
import type { SectionNode } from '../shared/types.js';
import { checkPermission } from '../rbac/permissions.js';
import { flattenTree, getSectionPath } from '../document/section-tree.js';
import { extractAnchor, headingSlug } from '../document/anchors.js';
import { refreshIndexForScope } from '../search/freshness.js';
import { getLogger } from '../shared/logger.js';

/** Sources listed per removed heading before collapsing to "and N more". */
const SOURCE_LIST_LIMIT = 10;

/**
 * Canonical key for a link fragment: `^id` for anchor links, otherwise the
 * heading slug, so `#retry-policy`, `Retry%20Policy` and `[[doc#Retry Policy]]`
 * all compare equal.
 */
function fragmentKey(fragment: string): string {
  let decoded = fragment;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    // Malformed percent escape — compare the raw value.
  }
  return decoded.startsWith('^') ? decoded : headingSlug(decoded);
}

interface HeadingRef { path: string; text: string }

/** Every key a link can use to address each heading → that heading. */
function headingKeys(tree: SectionNode[]): Map<string, HeadingRef> {
  const keys = new Map<string, HeadingRef>();
  for (const node of flattenTree(tree)) {
    const ref = { path: getSectionPath(node), text: node.heading.text };
    keys.set(headingSlug(node.heading.text), ref);
    if (node.heading.anchorId) keys.set(`^${node.heading.anchorId}`, ref);
  }
  return keys;
}

/** A source label: file plus its section path, `^id` tokens dropped for readability. */
function sourceLabel(file: string, section: string | null): string {
  if (!section) return file;
  const path = section.split(' > ').map((part) => extractAnchor(part).text).join(' > ');
  return `${file} (§ ${path})`;
}

function adviceFor(operation: string): string {
  if (operation === 'Rename section') {
    return 'Update those links; links by ^id survive renames (doc_assign_ids adds anchors).';
  }
  if (operation === 'Delete section') return 'Update or remove those links.';
  return 'Update those links. To rename a heading, prefer doc_rename_section — it carries ^id anchors across.';
}

/**
 * Warn about inbound links that a write breaks (#154). A heading slug or
 * `^id` present before the write and gone after it is looked up in the
 * backlink index; each removed heading with inbound links yields one warning.
 *
 * Only runs the (cheap) index refresh when something was actually removed,
 * so ordinary writes pay nothing. Sources the caller cannot read are left
 * out entirely — the same boundary as doc_referenced_by. Best-effort: a
 * failure here never fails the write.
 */
export function brokenInboundLinkWarnings(
  ctx: ToolContext,
  file: string,
  operation: string,
  oldTree: SectionNode[],
  newTree: SectionNode[],
): string[] {
  const before = headingKeys(oldTree);
  const after = headingKeys(newTree);
  const removed = new Map([...before].filter(([key]) => !after.has(key)));
  if (removed.size === 0) return [];

  try {
    // The backlink index is otherwise only refreshed at startup, on our own
    // writes and before searches — pick up links added by other tools.
    refreshIndexForScope(ctx.db, ctx.config.document_roots, undefined, {
      rescanIntervalMs: ctx.config.search?.rescan_interval_ms ?? 30_000,
      batchSize: ctx.config.search?.batch_size,
    });
  } catch (err) {
    getLogger().warn('write:link-refresh-failed', { file, error: String(err) });
  }

  const rows = ctx.db.prepare(
    `SELECT source_file, source_section, target_section FROM doc_links
     WHERE target_file = ? AND target_section IS NOT NULL ORDER BY source_file, id`,
  ).all(file) as Array<{ source_file: string; source_section: string | null; target_section: string }>;

  // Keyed by section path: a deleted heading's slug and ^id are one heading.
  const byHeading = new Map<string, { text: string; count: number; sources: Set<string> }>();
  for (const row of rows) {
    const heading = removed.get(fragmentKey(row.target_section));
    if (!heading || !checkPermission(ctx.caller, 'read', row.source_file).allowed) continue;
    const entry = byHeading.get(heading.path) ?? { text: heading.text, count: 0, sources: new Set<string>() };
    entry.count++;
    entry.sources.add(sourceLabel(row.source_file, row.source_section));
    byHeading.set(heading.path, entry);
  }

  return [...byHeading.values()].map(({ text, count, sources }) => {
    const listed = [...sources].slice(0, SOURCE_LIST_LIMIT);
    const more = sources.size - listed.length;
    return `Heading "${text}" no longer exists — ${count} inbound link${count === 1 ? '' : 's'} will break: `
      + `${listed.join(', ')}${more > 0 ? `, and ${more} more` : ''}. ${adviceFor(operation)}`;
  });
}
