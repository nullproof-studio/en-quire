// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ToolContext } from './context.js';
import { posix } from 'node:path';
import type { SectionNode } from '../shared/types.js';
import type { RawLink } from '../document/parser-registry.js';
import { checkPermission } from '../rbac/permissions.js';
import { flattenTree, getSectionPath } from '../document/section-tree.js';
import { extractAnchor, headingSlug } from '../document/anchors.js';
import { refreshIndexForScope } from '../search/freshness.js';
import { storeLinks } from '../search/link-storage.js';
import { resolveFilePath } from '../config/roots.js';
import { readDocument } from '../shared/file-utils.js';
import { parserRegistry } from '../document/parser-registry.js';
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

/**
 * The backlink index is otherwise only refreshed at startup, on our own
 * writes and before searches — pick up links added by other tools first.
 */
function refreshBacklinks(ctx: ToolContext, file: string): void {
  try {
    refreshIndexForScope(ctx.db, ctx.config.document_roots, undefined, {
      rescanIntervalMs: ctx.config.search?.rescan_interval_ms ?? 30_000,
      batchSize: ctx.config.search?.batch_size,
    });
  } catch (err) {
    getLogger().warn('write:link-refresh-failed', { file, error: String(err) });
  }
}

function listWithMore(items: Iterable<string>): string {
  const all = [...items];
  const listed = all.slice(0, SOURCE_LIST_LIMIT);
  const more = all.length - listed.length;
  return `${listed.join(', ')}${more > 0 ? `, and ${more} more` : ''}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

  refreshBacklinks(ctx, file);

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

  return [...byHeading.values()].map(({ text, count, sources }) =>
    `Heading "${text}" no longer exists — ${plural(count, 'inbound link')} will break: `
    + `${listWithMore(sources)}. ${adviceFor(operation)}`);
}

interface LinkRow { source_section: string | null; target_file: string }

/** Link rows captured before a file rename, compared against after it. */
export interface RenameLinkSnapshot {
  /** Rows of each other file that links to the renamed one, in index order. */
  inbound: Map<string, LinkRow[]>;
  /** The renamed file's own rows, in index order. */
  outbound: LinkRow[];
}

function rowsFrom(ctx: ToolContext, source: string): LinkRow[] {
  return ctx.db.prepare(
    'SELECT source_section, target_file FROM doc_links WHERE source_file = ? ORDER BY id',
  ).all(source) as LinkRow[];
}

/** Capture the links a rename of `oldPath` could break. Call before moving the file. */
export function snapshotRenameLinks(ctx: ToolContext, oldPath: string): RenameLinkSnapshot {
  refreshBacklinks(ctx, oldPath);
  const sources = ctx.db.prepare(
    'SELECT DISTINCT source_file FROM doc_links WHERE target_file = ? AND source_file != ?',
  ).all(oldPath, oldPath) as Array<{ source_file: string }>;
  return {
    inbound: new Map(sources.map(({ source_file }) => [source_file, rowsFrom(ctx, source_file)])),
    outbound: rowsFrom(ctx, oldPath),
  };
}

/** Re-resolve a file's links against the current index (its content is unchanged). */
function restoreLinks(ctx: ToolContext, source: string): RawLink[] {
  const resolved = resolveFilePath(ctx.config.document_roots, source);
  const { content } = readDocument(resolved.root.path, resolved.relativePath);
  const links = parserRegistry.getParser(resolved.relativePath).extractLinks?.(content) ?? [];
  storeLinks(ctx.db, source, links);
  return links;
}

/**
 * Where a markdown link points as renderers resolve it: relative to the
 * source file. The index is more lenient — a bare `[x](spec.md)` matches any
 * `spec.md` by basename — so it would call a link that a folder move broke
 * still fine. Null for wiki links, root-anchored and same-document targets,
 * which a move doesn't re-base.
 */
function relativeTarget(source: string, link: RawLink | undefined): string | null {
  if (link?.style !== 'markdown' || !link.target_path || link.target_path.startsWith('/')) return null;
  let target = link.target_path;
  try {
    target = decodeURIComponent(target);
  } catch {
    // Malformed escape — resolve the raw value.
  }
  return posix.normalize(posix.join(posix.dirname(source), target));
}

function isIndexed(ctx: ToolContext, path: string): boolean {
  return ctx.db.prepare('SELECT 1 FROM index_metadata WHERE file_path = ?').get(path) !== undefined;
}

/**
 * Warn about links a file rename broke (#154). Call after the old path is
 * removed from the index and the new path indexed with `links` (the renamed
 * file's extracted links).
 *
 * - Inbound: each linking file's links are re-resolved — which also keeps the
 *   index correct — and a row that pointed at the old path is broken if the
 *   index no longer reaches the new one, or if it's a markdown link whose
 *   relative path named the old location. Wiki links resolve by basename,
 *   so they survive a folder move but not a basename change.
 * - Outbound: the renamed file's relative links resolve from its new folder;
 *   a row that resolved before and doesn't now is broken.
 *
 * Content is unchanged on both sides, so rows pair up one-for-one in index
 * order. Files the caller cannot read are omitted. Best-effort per file.
 */
export function renameLinkWarnings(
  ctx: ToolContext,
  oldPath: string,
  newPath: string,
  snapshot: RenameLinkSnapshot,
  links: RawLink[],
): string[] {
  const warnings: string[] = [];

  let inboundCount = 0;
  const inboundSources = new Set<string>();
  for (const [source, before] of snapshot.inbound) {
    // Re-resolve every linking file so the index stays correct; only report
    // the ones the caller can read.
    let links: RawLink[];
    try {
      links = restoreLinks(ctx, source);
    } catch (err) {
      getLogger().warn('rename:link-restore-failed', { source, error: String(err) });
      continue;
    }
    if (!checkPermission(ctx.caller, 'read', source).allowed) continue;
    const after = rowsFrom(ctx, source);
    if (after.length !== before.length) continue; // changed underneath us — can't pair rows
    before.forEach((row, i) => {
      if (row.target_file !== oldPath) return;
      // Broken if the index no longer reaches the new path, or if it's a
      // markdown link spelled as a path to the old location.
      if (after[i].target_file !== newPath || relativeTarget(source, links[i]) === oldPath) {
        inboundCount++;
        inboundSources.add(sourceLabel(source, row.source_section));
      }
    });
  }
  if (inboundCount > 0) {
    warnings.push(
      `Renaming ${oldPath} → ${newPath} breaks ${plural(inboundCount, 'inbound link')}: `
      + `${listWithMore(inboundSources)}. Update ${inboundCount === 1 ? 'it' : 'them'} to point at ${newPath}.`,
    );
  }

  const after = rowsFrom(ctx, newPath);
  if (after.length === snapshot.outbound.length && links.length === after.length) {
    const lost = new Set<string>();
    let lostCount = 0;
    snapshot.outbound.forEach((row, i) => {
      const was = row.target_file;
      if (was.startsWith('?')) return; // already unresolved before the move
      // A markdown link that resolved as a relative path breaks when its new
      // relative target doesn't exist; anything else breaks when the index
      // can no longer resolve it.
      const relBefore = relativeTarget(oldPath, links[i]);
      const broken = relBefore === was
        ? !isIndexed(ctx, relativeTarget(newPath, links[i])!)
        : after[i].target_file.startsWith('?');
      if (!broken || !checkPermission(ctx.caller, 'read', was).allowed) return;
      lostCount++;
      lost.add(was);
    });
    if (lostCount > 0) {
      warnings.push(
        `${plural(lostCount, 'link')} in ${newPath} no longer ${lostCount === 1 ? 'resolves' : 'resolve'} from its new location: `
        + `${listWithMore(lost)}. Update them relative to the new path.`,
      );
    }
  }

  return warnings;
}
