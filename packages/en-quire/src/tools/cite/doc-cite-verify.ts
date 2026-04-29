// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ToolContext, FetchSourceContext } from '@nullproof-studio/en-core';
import {
  CiteRateLimiter,
  fetchSource,
  getCitationById,
  updateCitationVerification,
  verifyQuote,
} from '@nullproof-studio/en-core';

export const DocCiteVerifySchema = z.object({
  citation_id: z.string().describe('The citation_id returned by a prior doc_cite call.'),
  source: z.string().optional().describe(
    'Optional override of the source URI. Defaults to the URI stored in the registry — pass only if you want to re-fetch from a different location.',
  ),
});

export type DocCiteVerifyResult =
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

export async function handleDocCiteVerify(
  args: z.infer<typeof DocCiteVerifySchema>,
  ctx: ToolContext,
): Promise<DocCiteVerifyResult> {
  if (!ctx.config.citation.enabled) {
    return { status: 'not_found', reason: 'citation feature is disabled' };
  }
  const stored = getCitationById(ctx.db, args.citation_id);
  if (!stored) {
    return { status: 'not_found', reason: 'unknown citation_id' };
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

  const sourceUri = args.source ?? stored.source_uri;
  const fetched = await fetchSource(sourceUri, fetchCtx);
  if (!fetched.ok) {
    return { status: fetched.reason, reason: fetched.detail ?? fetched.reason };
  }

  const current_hash = createHash('sha256').update(fetched.source.text).digest('hex');
  const verify = verifyQuote(fetched.source.text, stored.quote_text);
  const text_still_present = verify.status !== 'not_found';

  const verified_at = (runtime.clock?.() ?? new Date()).toISOString();
  updateCitationVerification(ctx.db, args.citation_id, current_hash, verified_at);

  return {
    status: 'verified',
    citation_id: args.citation_id,
    original_hash: stored.source_hash,
    current_hash,
    hash_match: current_hash === stored.source_hash,
    text_still_present,
    verified_at,
  };
}
