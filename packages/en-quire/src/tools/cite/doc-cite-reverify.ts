// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  ToolContext,
  FetchSourceContext,
  Permission,
  CitationRecord,
} from '@nullproof-studio/en-core';
import {
  CiteRateLimiter,
  fetchSource,
  getCitationById,
  logCiteAudit,
  requirePermission,
  updateCitationVerification,
  verifyQuote,
} from '@nullproof-studio/en-core';

export const DocCiteReverifySchema = z.object({
  citation_id: z.string().describe('The citation_id returned by a prior doc_cite call.'),
  // Note: no `source` override. The verify path always uses the URI stored
  // at cite time. Allowing a caller to pass a different URI would let
  // them launder one host's permissions through another's citation_id.
});

export type DocCiteReverifyResult =
  | { status: 'not_found'; reason: string }
  | { status: 'source_blocked' | 'source_not_found' | 'source_too_large' | 'source_too_many_redirects' | 'source_not_readable' | 'rate_limited'; reason: string }
  | {
      status: 'verified';
      citation_id: string;
      original_hash: string;
      current_hash: string;
      hash_match: boolean;
      text_still_present: boolean;
      verified_at: string;
    };

export async function handleDocCiteReverify(
  args: z.infer<typeof DocCiteReverifySchema>,
  ctx: ToolContext,
): Promise<DocCiteReverifyResult> {
  if (!ctx.config.citation.enabled) {
    return { status: 'not_found', reason: 'citation feature is disabled' };
  }
  const stored = getCitationById(ctx.db, args.citation_id);
  if (!stored) {
    return { status: 'not_found', reason: 'unknown citation_id' };
  }

  // Permission gate: same rules as doc_cite. Reverifying is the same
  // network/IO capability as a fresh cite. Without this check, a
  // low-privileged caller could enumerate sequential citation_ids and
  // trigger arbitrary outbound fetches to allowlisted hosts and re-read
  // en-quire-managed sources they should not see.
  //
  // Local sources also need `read` on the equivalent root-prefixed path —
  // for both en-quire managed and file:// stored citations. Without the
  // file:// check, hash_match and text_still_present leak observable
  // state about a private file the caller can't read directly.
  const requiredPerm = requiredPermissionFor(stored);
  requirePermission(ctx.caller, requiredPerm, stored.target_file ?? '**');
  if (stored.source_scheme === 'enquire') {
    requirePermission(ctx.caller, 'read', stored.source_uri);
  }
  if (stored.source_scheme === 'file') {
    const prefixed = filePathToPrefixed(stored.source_uri, ctx.config.document_roots);
    if (prefixed) requirePermission(ctx.caller, 'read', prefixed);
  }

  const runtime =
    ctx.cite ?? {
      rateLimiter: new CiteRateLimiter({
        perMinute: ctx.config.citation.rate_limit.external_per_minute,
      }),
    };

  const documentRoots: Record<string, string> = {};
  for (const [name, root] of Object.entries(ctx.config.document_roots)) {
    documentRoots[name] = root.path;
  }
  const fetchCtx: FetchSourceContext = {
    caller_id: ctx.caller.id,
    config: ctx.config.citation.fetch,
    documentRoots,
    dispatcher: runtime.dispatcher,
    resolveDns: runtime.resolveDns,
    rateLimiter: runtime.rateLimiter,
    clock: runtime.clock,
  };

  const fetched = await fetchSource(stored.source_uri, fetchCtx);
  if (!fetched.ok) {
    logCiteAudit(ctx.db, {
      caller_id: ctx.caller.id,
      target_file: stored.target_file,
      source_scheme: fetched.source_scheme,
      canonical_host: fetched.canonical_host,
      canonical_path: fetched.canonical_path_redacted ?? fetched.canonical_path,
      status: fetched.reason,
      reason: fetched.detail ?? `reverify:${fetched.reason}`,
      citation_id: args.citation_id,
      source_hash: null,
    });
    return { status: fetched.reason, reason: fetched.detail ?? fetched.reason };
  }

  const current_hash = createHash('sha256').update(fetched.source.text).digest('hex');
  const verify = verifyQuote(fetched.source.text, stored.quote_text);
  const text_still_present = verify.status !== 'not_found';
  const hash_match = current_hash === stored.source_hash;

  const verified_at = (runtime.clock?.() ?? new Date()).toISOString();
  updateCitationVerification(ctx.db, args.citation_id, current_hash, verified_at);

  logCiteAudit(ctx.db, {
    caller_id: ctx.caller.id,
    target_file: stored.target_file,
    source_scheme: fetched.source.source_scheme,
    canonical_host: fetched.source.canonical_host,
    canonical_path: fetched.source.canonical_path,
    status: 'verified',
    reason: hash_match ? null : (text_still_present ? 'reverify:hash_drift' : 'reverify:text_gone'),
    citation_id: args.citation_id,
    source_hash: current_hash,
  });

  return {
    status: 'verified',
    citation_id: args.citation_id,
    original_hash: stored.source_hash,
    current_hash,
    hash_match,
    text_still_present,
    verified_at,
  };
}

function requiredPermissionFor(stored: CitationRecord): Permission {
  return stored.source_scheme === 'https' || stored.source_scheme === 'http'
    ? 'cite_web'
    : 'cite';
}

/**
 * Mirror of the helper in doc-cite.ts: map a file:// URI to its
 * equivalent root-prefixed en-quire path so caller `read` scopes apply
 * identically to file:// and bare en-quire sources. Returns null when
 * the absolute target lies outside every configured root (in which
 * case fetchSource will reject it as source_blocked anyway, but we
 * skip the read check rather than RBAC-test against an arbitrary
 * absolute path).
 */
function filePathToPrefixed(
  uri: string,
  roots: Record<string, { path: string }>,
): string | null {
  const absolute = decodeURIComponent(uri.slice('file://'.length));
  for (const [rootName, root] of Object.entries(roots)) {
    const rootPath = root.path;
    if (absolute === rootPath || absolute.startsWith(rootPath + '/')) {
      const rel = absolute === rootPath ? '' : absolute.slice(rootPath.length + 1);
      return rel ? `${rootName}/${rel}` : rootName;
    }
  }
  return null;
}
