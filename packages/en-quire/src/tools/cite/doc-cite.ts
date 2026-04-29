// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  ToolContext,
  CitationWarningCode,
  FetchedSource,
  FetchSourceContext,
  Permission,
} from '@nullproof-studio/en-core';
import {
  allocateAndInsertCitation,
  appendToSection as _appendToSection,
  buildCitationAppend,
  CiteRateLimiter,
  executeWrite,
  fetchSource,
  formatInline,
  formatReferenceLine,
  loadDocument,
  logCiteAudit,
  requirePermission,
  verifyQuote,
} from '@nullproof-studio/en-core';

export const DocCiteSchema = z.object({
  source: z.string().describe(
    'Source URI. Supported: https://… (requires cite_web), file://… (must lie inside a configured root), bare en-quire managed paths like "docs/foo.md", and pdf://… (deferred to phase 2 — returns source_not_readable).',
  ),
  quote: z.string().describe(
    'The exact verbatim text the agent believes is in the source. The tool independently re-fetches the source and confirms or denies. Empty quotes are rejected.',
  ),
  target_file: z.string().optional().describe(
    'Optional. If set, on a verified cite the tool auto-appends a content-free reference line "(N) <canonical-URL> [hash:sha256:HEX]" to the target file\'s Citations section.',
  ),
  if_match: z.string().optional().describe(
    'ETag of target_file from a prior read. Required when require_read_before_write is enabled and target_file is set.',
  ),
  force: z.boolean().optional().describe(
    'Bypass dedupe. By default, re-citing the same (target_file, source, quote) returns the existing citation_id. force:true allocates a new number.',
  ),
  message: z.string().optional().describe('Commit message to use for the auto-append.'),
});

export type DocCiteResult =
  | { status: 'disabled'; reason: string }
  | {
      status: 'verified';
      citation_id: string;
      citation_number: number;
      source_hash: string;
      formatted_inline: string;
      formatted_reference: string;
      append?: { mode: 'write'; commit?: string; etag?: string };
    }
  | {
      status: 'warning';
      warning_code: CitationWarningCode;
      citation_id: string;
      citation_number: number;
      source_hash: string;
      formatted_reference: string;
    }
  | {
      status:
        | 'not_found'
        | 'source_not_found'
        | 'source_blocked'
        | 'source_too_large'
        | 'source_too_many_redirects'
        | 'source_not_readable'
        | 'rate_limited';
      reason: string;
    };

export async function handleDocCite(
  args: z.infer<typeof DocCiteSchema>,
  ctx: ToolContext,
): Promise<DocCiteResult> {
  if (!ctx.config.citation.enabled) {
    return { status: 'disabled', reason: 'citation feature is disabled in server config' };
  }
  if (args.quote.length === 0) {
    throw new Error('quote must be a non-empty string');
  }

  const scheme = inferScheme(args.source);
  const requiredPerm: Permission = scheme === 'http' || scheme === 'https' ? 'cite_web' : 'cite';
  // Permission check: target_file when present, else against ** so callers
  // without a broad grant can't probe the cite tool.
  requirePermission(ctx.caller, requiredPerm, args.target_file ?? '**');
  // En-quire managed sources additionally need read on the source path.
  if (scheme === 'enquire') {
    requirePermission(ctx.caller, 'read', args.source);
  }

  // Resolve cite runtime — production servers wire it once at startup; the
  // fallback creates a per-call limiter that satisfies tests that haven't
  // injected a runtime. Production deployments should always supply ctx.cite.
  const runtime =
    ctx.cite ?? {
      rateLimiter: new CiteRateLimiter({
        perMinute: ctx.config.citation.rate_limit.external_per_minute,
      }),
    };

  // Build the fetch-source context. documentRoots is name → absolute path.
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

  // 1. Fetch.
  const fetched = await fetchSource(args.source, fetchCtx);

  if (!fetched.ok) {
    logCiteAudit(ctx.db, {
      caller_id: ctx.caller.id,
      target_file: args.target_file ?? null,
      source_scheme: fetched.source_scheme,
      canonical_host: fetched.canonical_host,
      canonical_path: fetched.canonical_path_redacted ?? fetched.canonical_path,
      status: fetched.reason,
      reason: fetched.detail ?? null,
      citation_id: null,
      source_hash: null,
    });
    return { status: fetched.reason, reason: fetched.detail ?? fetched.reason };
  }

  // 2. Verify quote against the fetched canonical text. Source text is
  // dropped after this step — never written, never returned, never logged.
  const verify = verifyQuote(fetched.source.text, args.quote);
  if (verify.status === 'not_found') {
    logCiteAudit(ctx.db, auditFor(ctx, args, fetched.source, 'not_found', null, null, null));
    return { status: 'not_found', reason: 'not_found' };
  }

  // 3. Hash the canonical text (server-computed; the agent can't forge).
  const source_hash = createHash('sha256').update(fetched.source.text).digest('hex');

  // 4. Allocate the citation row (handles dedupe + force internally).
  const cited = allocateAndInsertCitation(ctx.db, {
    target_file: args.target_file ?? null,
    source_uri: fetched.source.canonical_uri,
    source_scheme: fetched.source.source_scheme,
    source_hash,
    quote_text: args.quote,
    quote_offset: verify.match.offset,
    quote_line: verify.match.line,
    status: verify.status,
    warning_code: verify.status === 'warning' ? verify.warning_code : null,
    caller_id: ctx.caller.id,
    force: args.force,
  });

  // 5. Format outputs.
  const formatted_reference = formatReferenceLine({
    source_uri: cited.source_uri,
    citation_number: cited.citation_number,
    source_hash,
  });
  const formatted_inline = formatInline(args.quote, cited.citation_number);

  // 6. Auto-append (only when verified and target_file is set, and only on
  // a fresh insert — re-cites that hit dedupe shouldn't re-write the doc).
  let append: { mode: 'write'; commit?: string; etag?: string } | undefined;
  if (verify.status === 'verified' && args.target_file && cited.is_new) {
    const { content, encoding } = loadDocument(ctx, args.target_file);
    const newContent = buildCitationAppend(
      content,
      formatted_reference,
      ctx.config.citation.section_heading,
    );
    const writeResult = await executeWrite(
      ctx,
      {
        file: args.target_file,
        operation: 'doc_cite append',
        target: ctx.config.citation.section_heading,
        mode: 'write',
        message: args.message ?? `cite: ${formatted_reference.slice(0, 80)}`,
        if_match: args.if_match,
      },
      content,
      newContent,
      encoding,
    );
    append = { mode: 'write', commit: writeResult.commit, etag: writeResult.etag };
  }

  // 7. Audit log.
  logCiteAudit(ctx.db, auditFor(
    ctx,
    args,
    fetched.source,
    verify.status,
    null,
    cited.citation_id,
    source_hash,
  ));

  if (verify.status === 'warning') {
    return {
      status: 'warning',
      warning_code: verify.warning_code,
      citation_id: cited.citation_id,
      citation_number: cited.citation_number,
      source_hash,
      formatted_reference,
    };
  }
  return {
    status: 'verified',
    citation_id: cited.citation_id,
    citation_number: cited.citation_number,
    source_hash,
    formatted_inline,
    formatted_reference,
    ...(append ? { append } : {}),
  };
}

function inferScheme(source: string): 'http' | 'https' | 'file' | 'enquire' | 'pdf' | 'unknown' {
  if (source.startsWith('https://')) return 'https';
  if (source.startsWith('http://')) return 'http';
  if (source.startsWith('file://')) return 'file';
  if (source.startsWith('pdf:')) return 'pdf';
  if (!source.includes('://') && source.includes('/')) return 'enquire';
  return 'unknown';
}

function auditFor(
  ctx: ToolContext,
  args: z.infer<typeof DocCiteSchema>,
  source: FetchedSource,
  status: string,
  reason: string | null,
  citation_id: string | null,
  source_hash: string | null,
) {
  return {
    caller_id: ctx.caller.id,
    target_file: args.target_file ?? null,
    source_scheme: source.source_scheme,
    canonical_host: source.canonical_host,
    canonical_path: source.canonical_path,
    status,
    reason,
    citation_id,
    source_hash,
  };
}
