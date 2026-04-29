// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { readFile } from 'node:fs/promises';
import { resolve, isAbsolute, sep } from 'node:path';
import * as cheerio from 'cheerio';
import type { Dispatcher } from 'undici';
import { request } from 'undici';
import type { CiteRateLimiter } from './rate-limit.js';
import {
  evaluateUrlPolicy,
  isPrivateIpv4,
  isPrivateIpv6,
  type SecretPatternName,
  type UrlPolicyConfig,
} from './url-policy.js';

export type FetchedSource = {
  /** Canonical text used for findText + hashing. Caller drops it after use. */
  text: string;
  contentType: 'html' | 'markdown' | 'plain' | 'json' | 'yaml' | 'jsonl' | 'pdf';
  fetchedAt: string;
  /** The canonical URI (no query/fragment/userinfo). What gets written to docs. */
  canonical_uri: string;
  /** Lowercased host for HTTPS sources; null otherwise. */
  canonical_host: string | null;
  /** Path component (https) or relative file path (local). */
  canonical_path: string;
  /** Source scheme code used in the registry / audit log. */
  source_scheme: 'https' | 'http' | 'file' | 'enquire';
  byteSize: number;
};

export type FetchFailureReason =
  | 'source_not_found'
  | 'source_blocked'
  | 'source_too_large'
  | 'source_too_many_redirects'
  | 'source_not_readable'
  | 'rate_limited';

export interface FetchFailure {
  ok: false;
  reason: FetchFailureReason;
  /** Echoed from URL policy — the matched secret-pattern name, if any. */
  matched_pattern?: SecretPatternName;
  canonical_path_redacted?: string;
  canonical_host: string | null;
  canonical_path: string | null;
  source_scheme: string;
  /** Human-readable detail for logs (never returned to the agent). */
  detail?: string;
}

export type FetchSourceResult = { ok: true; source: FetchedSource } | FetchFailure;

export interface FetchSourceContext {
  caller_id: string;
  config: UrlPolicyConfig & {
    use_proxy_env?: boolean;
    allowed_content_types: string[];
    timeout_ms: number;
    max_bytes: number;
    max_redirects: number;
    decompression_factor?: number;
  };
  /** Map of root name → absolute path. */
  documentRoots: Record<string, string>;
  dispatcher?: Dispatcher;
  /** Resolve a hostname to a list of A/AAAA strings. Inject for tests. */
  resolveDns?: (host: string) => Promise<string[]>;
  rateLimiter?: CiteRateLimiter;
  clock?: () => Date;
}

const PDF_PREFIX = 'pdf:';
const FILE_PREFIX = 'file://';

export async function fetchSource(uri: string, ctx: FetchSourceContext): Promise<FetchSourceResult> {
  if (uri.startsWith(PDF_PREFIX)) {
    return {
      ok: false,
      reason: 'source_not_readable',
      canonical_host: null,
      canonical_path: null,
      source_scheme: 'pdf',
      detail: 'PDF support is not yet enabled in this version (deferred to phase 2).',
    };
  }
  if (uri.startsWith('https://') || uri.startsWith('http://')) {
    return fetchHttp(uri, ctx);
  }
  if (uri.startsWith(FILE_PREFIX)) {
    return fetchFile(uri.slice(FILE_PREFIX.length), 'file', ctx);
  }
  // Bare paths are en-quire managed: "rootname/path/to/file.md".
  if (looksLikeBarePath(uri)) {
    return fetchEnquireManaged(uri, ctx);
  }
  return {
    ok: false,
    reason: 'source_not_readable',
    canonical_host: null,
    canonical_path: null,
    source_scheme: 'unknown',
    detail: `Unsupported source URI scheme: ${uri.slice(0, 16)}…`,
  };
}

// ---------- HTTPS / HTTP ----------

async function fetchHttp(uri: string, ctx: FetchSourceContext): Promise<FetchSourceResult> {
  // Rate limit first — exhausted callers don't get to probe.
  if (ctx.rateLimiter && !ctx.rateLimiter.tryAcquire(ctx.caller_id)) {
    return {
      ok: false,
      reason: 'rate_limited',
      canonical_host: null,
      canonical_path: null,
      source_scheme: 'https',
      detail: 'Per-caller external citation rate limit exceeded.',
    };
  }

  const policy = evaluateUrlPolicy(uri, ctx.config);
  if (!policy.ok) {
    return {
      ok: false,
      reason: 'source_blocked',
      matched_pattern: policy.matched_pattern,
      canonical_path_redacted: policy.canonical_path_redacted,
      canonical_host: policy.canonical_host ?? null,
      canonical_path: null,
      source_scheme: uri.startsWith('https://') ? 'https' : 'http',
      detail: policy.reason,
    };
  }

  // DNS resolution + private-range check on the canonical host. URL parser
  // gives us a hostname; if it's already an IP literal the URL-policy guard
  // has covered private IPs. For real hostnames we still resolve to catch
  // public-host-resolves-to-private-IP attacks.
  const dnsHost = stripBrackets(policy.canonical_host);
  if (!isIpLiteral(dnsHost)) {
    const resolveDns = ctx.resolveDns ?? defaultResolveDns;
    const records = await resolveDns(dnsHost);
    if (records.length === 0) {
      return blocked('source_blocked', policy, 'dns_no_records');
    }
    for (const ip of records) {
      if (isAddressPrivate(ip)) {
        return blocked('source_blocked', policy, 'dns_resolved_to_private_ip');
      }
    }
  }

  // Issue the HTTP request.
  const reqOpts: Parameters<typeof request>[1] = {
    method: 'GET',
    headersTimeout: ctx.config.timeout_ms,
    bodyTimeout: ctx.config.timeout_ms,
    maxRedirections: ctx.config.max_redirects,
    headers: {
      // Identify ourselves clearly; refuse compression accept-encoding fancy
      // forms to keep decompression-bomb surface predictable.
      'user-agent': 'en-quire-doc-cite/0.3 (+https://github.com/nullproof-studio/en-quire)',
      accept: ctx.config.allowed_content_types.join(', '),
      'accept-encoding': 'identity',
    },
  };
  if (ctx.dispatcher) reqOpts.dispatcher = ctx.dispatcher;

  let res: Awaited<ReturnType<typeof request>>;
  try {
    res = await request(policy.canonical_uri, reqOpts);
  } catch (err) {
    return blocked(
      'source_not_found',
      policy,
      `fetch_error: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }

  if (res.statusCode === 404) {
    await drainBody(res.body);
    return blocked('source_not_found', policy, `http_${res.statusCode}`);
  }
  if (res.statusCode >= 400) {
    await drainBody(res.body);
    return blocked('source_not_found', policy, `http_${res.statusCode}`);
  }

  // Content-Length pre-check.
  const contentLength = Number.parseInt(String(res.headers['content-length'] ?? ''), 10);
  if (Number.isFinite(contentLength) && contentLength > ctx.config.max_bytes) {
    await drainBody(res.body);
    return blocked('source_too_large', policy, `content_length_${contentLength}`);
  }

  // Content-Type allowlist.
  const ctHeader = String(res.headers['content-type'] ?? '');
  const ct = ctHeader.split(';')[0].trim().toLowerCase();
  if (!ctx.config.allowed_content_types.includes(ct)) {
    await drainBody(res.body);
    return blocked('source_not_readable', policy, `content_type_${ct}`);
  }

  // Stream body up to max_bytes.
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of res.body) {
    const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk);
    bytes += buf.byteLength;
    if (bytes > ctx.config.max_bytes) {
      return blocked('source_too_large', policy, 'streamed_body_over_cap');
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8');

  // Extract canonical text by content type.
  const text = extractText(raw, ct);
  const contentType = pickContentType(ct);

  return {
    ok: true,
    source: {
      text,
      contentType,
      fetchedAt: (ctx.clock?.() ?? new Date()).toISOString(),
      canonical_uri: policy.canonical_uri,
      canonical_host: policy.canonical_host,
      canonical_path: policy.canonical_path,
      source_scheme: policy.scheme,
      byteSize: bytes,
    },
  };
}

function blocked(
  reason: FetchFailureReason,
  policy: { canonical_host?: string; canonical_path?: string; scheme?: 'https' | 'http' },
  detail: string,
): FetchFailure {
  return {
    ok: false,
    reason,
    canonical_host: policy.canonical_host ?? null,
    canonical_path: policy.canonical_path ?? null,
    source_scheme: policy.scheme ?? 'https',
    detail,
  };
}

async function drainBody(body: AsyncIterable<unknown>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of body) {
    // discard
  }
}

function stripBrackets(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) return host.slice(1, -1);
  return host;
}

function isIpLiteral(host: string): boolean {
  if (host.includes(':')) return true; // IPv6
  return /^\d/.test(host); // any leading digit → numeric IPv4 form
}

function isAddressPrivate(ip: string): boolean {
  if (ip.includes(':')) return isPrivateIpv6(ip);
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return false;
  return isPrivateIpv4(parts as [number, number, number, number]);
}

async function defaultResolveDns(host: string): Promise<string[]> {
  const dns = await import('node:dns/promises');
  try {
    const v4 = await dns.resolve4(host).catch(() => [] as string[]);
    const v6 = await dns.resolve6(host).catch(() => [] as string[]);
    return [...v4, ...v6];
  } catch {
    return [];
  }
}

function pickContentType(ct: string): FetchedSource['contentType'] {
  if (ct === 'text/html' || ct === 'application/xhtml+xml') return 'html';
  if (ct === 'text/markdown') return 'markdown';
  if (ct === 'application/json') return 'json';
  return 'plain';
}

function extractText(raw: string, ct: string): string {
  if (ct === 'text/html' || ct === 'application/xhtml+xml') {
    const $ = cheerio.load(raw);
    // Strip injection-prone elements before pulling text.
    $('script, style, noscript, iframe, object, embed, svg').remove();
    $('*').each((_, el) => {
      const node = el as { attribs?: Record<string, string> };
      if (!node.attribs) return;
      for (const attr of Object.keys(node.attribs)) {
        if (attr.startsWith('on')) delete node.attribs[attr];
      }
    });
    return $('body').text() || $.root().text();
  }
  return raw;
}

// ---------- file:// + bare en-quire managed paths ----------

function looksLikeBarePath(uri: string): boolean {
  // No URI scheme, no leading "/", at least one "/" in the value.
  if (uri.includes('://')) return false;
  if (uri.startsWith('/')) return false;
  return uri.includes('/');
}

async function fetchEnquireManaged(
  uri: string,
  ctx: FetchSourceContext,
): Promise<FetchSourceResult> {
  const slashIdx = uri.indexOf('/');
  const rootName = uri.slice(0, slashIdx);
  const relPath = uri.slice(slashIdx + 1);
  const rootPath = ctx.documentRoots[rootName];
  if (!rootPath) {
    return {
      ok: false,
      reason: 'source_blocked',
      canonical_host: null,
      canonical_path: uri,
      source_scheme: 'enquire',
      detail: `unknown_root:${rootName}`,
    };
  }
  return readLocalFile(resolve(rootPath, relPath), rootPath, uri, 'enquire', ctx);
}

async function fetchFile(
  rawPath: string,
  scheme: 'file',
  ctx: FetchSourceContext,
): Promise<FetchSourceResult> {
  const decoded = decodeURIComponent(rawPath);
  if (!isAbsolute(decoded)) {
    return {
      ok: false,
      reason: 'source_not_readable',
      canonical_host: null,
      canonical_path: decoded,
      source_scheme: scheme,
      detail: 'file:// requires an absolute path',
    };
  }
  // Confirm the file lives inside SOME configured root.
  let containingRoot: string | null = null;
  for (const root of Object.values(ctx.documentRoots)) {
    const rootResolved = resolve(root);
    const target = resolve(decoded);
    if (target === rootResolved || target.startsWith(rootResolved + sep)) {
      containingRoot = rootResolved;
      break;
    }
  }
  if (!containingRoot) {
    return {
      ok: false,
      reason: 'source_blocked',
      canonical_host: null,
      canonical_path: decoded,
      source_scheme: scheme,
      detail: 'file_outside_any_root',
    };
  }
  return readLocalFile(decoded, containingRoot, `file://${decoded}`, scheme, ctx);
}

async function readLocalFile(
  absolutePath: string,
  rootPath: string,
  canonicalUri: string,
  scheme: 'file' | 'enquire',
  ctx: FetchSourceContext,
): Promise<FetchSourceResult> {
  // Re-check containment after path resolution.
  const resolved = resolve(absolutePath);
  const resolvedRoot = resolve(rootPath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + sep)) {
    return {
      ok: false,
      reason: 'source_blocked',
      canonical_host: null,
      canonical_path: canonicalUri,
      source_scheme: scheme,
      detail: 'path_outside_root_post_resolution',
    };
  }
  let raw: string;
  try {
    raw = await readFile(resolved, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {
        ok: false,
        reason: 'source_not_found',
        canonical_host: null,
        canonical_path: canonicalUri,
        source_scheme: scheme,
        detail: 'enoent',
      };
    }
    return {
      ok: false,
      reason: 'source_not_readable',
      canonical_host: null,
      canonical_path: canonicalUri,
      source_scheme: scheme,
      detail: `fs_error:${code ?? 'unknown'}`,
    };
  }
  const contentType = guessLocalContentType(canonicalUri);
  return {
    ok: true,
    source: {
      text: raw,
      contentType,
      fetchedAt: (ctx.clock?.() ?? new Date()).toISOString(),
      canonical_uri: canonicalUri,
      canonical_host: null,
      canonical_path: canonicalUri,
      source_scheme: scheme,
      byteSize: Buffer.byteLength(raw, 'utf8'),
    },
  };
}

function guessLocalContentType(uri: string): FetchedSource['contentType'] {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return 'markdown';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  if (lower.endsWith('.jsonl') || lower.endsWith('.ndjson')) return 'jsonl';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  return 'plain';
}
