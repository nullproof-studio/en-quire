// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import micromatch from 'micromatch';

export type UrlPolicyReason =
  | 'invalid_url'
  | 'unsupported_scheme'
  | 'plaintext_http_disallowed'
  | 'userinfo_disallowed'
  | 'host_too_long'
  | 'path_too_long'
  | 'private_ip_literal'
  | 'allowlist_miss'
  | 'suspicious_url_pattern'
  | 'malformed_chars';

export interface UrlPolicyConfig {
  https_only: boolean;
  http_allowlist: string[];
  block_private_ranges: boolean;
  strip_query: boolean;
  strip_fragment: boolean;
  allow_userinfo: boolean;
  max_path_chars: number;
  max_host_chars: number;
  secret_pattern_reject: boolean;
}

export type UrlPolicyResult =
  | {
      ok: true;
      canonical_uri: string;
      canonical_host: string;
      canonical_path: string;
      scheme: 'https' | 'http';
    }
  | {
      ok: false;
      reason: UrlPolicyReason;
      /** Set when reason is 'suspicious_url_pattern'. */
      matched_pattern?: SecretPatternName;
      /**
       * Path with the matched secret segment redacted, suitable for audit
       * logging. Set only when reason is 'suspicious_url_pattern'.
       */
      canonical_path_redacted?: string;
      /** Best-effort canonical host for audit logs (may be empty). */
      canonical_host?: string;
    };

export type SecretPatternName =
  | 'openai-key'
  | 'github-pat'
  | 'slack-token'
  | 'jwt'
  | 'high-entropy-blob';

const SECRET_PATTERNS: ReadonlyArray<{ name: SecretPatternName; regex: RegExp }> = [
  { name: 'openai-key', regex: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'github-pat', regex: /(gh[opusr])_[A-Za-z0-9]{30,}/ },
  { name: 'slack-token', regex: /xox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'jwt', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  // Long high-entropy blob — single path segment ≥ 64 chars of hex/base64url.
  { name: 'high-entropy-blob', regex: /(?:^|[/?&=])([A-Za-z0-9_-]{64,})(?:$|[/?&=])/ },
];

// Whitespace and control chars in the raw input are rejected up-front —
// Node's URL parser silently percent-encodes them, so by the time we have
// `parsed` they're gone. `]` is legitimate inside IPv6 hostname brackets,
// so we only reject it after parsing, on the path+query+fragment.
const URL_RAW_DISALLOWED = /[\s\x00-\x1F\x7F]/;
const URL_BRACKET_DISALLOWED = /\]/;

export function evaluateUrlPolicy(uri: string, config: UrlPolicyConfig): UrlPolicyResult {
  if (URL_RAW_DISALLOWED.test(uri)) {
    return { ok: false, reason: 'malformed_chars' };
  }

  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (URL_BRACKET_DISALLOWED.test(`${parsed.pathname}${parsed.search}${parsed.hash}`)) {
    return { ok: false, reason: 'malformed_chars' };
  }

  // Scheme
  let scheme: 'https' | 'http';
  if (parsed.protocol === 'https:') {
    scheme = 'https';
  } else if (parsed.protocol === 'http:') {
    if (config.https_only) {
      return { ok: false, reason: 'plaintext_http_disallowed' };
    }
    scheme = 'http';
  } else {
    return { ok: false, reason: 'unsupported_scheme' };
  }

  // Userinfo (user:pass@host)
  if ((parsed.username || parsed.password) && !config.allow_userinfo) {
    return { ok: false, reason: 'userinfo_disallowed' };
  }

  // Host normalisation. URL.hostname is already lowercased. IPv6 literals are
  // wrapped in [..].
  const host = parsed.hostname;
  if (host.length === 0) return { ok: false, reason: 'invalid_url' };
  if (host.length > config.max_host_chars) {
    return { ok: false, reason: 'host_too_long' };
  }

  const path = parsed.pathname.length === 0 ? '/' : parsed.pathname;
  if (path.length > config.max_path_chars) {
    return { ok: false, reason: 'path_too_long' };
  }

  // Private/loopback IP literal check (pre-DNS — catches direct attacks).
  if (config.block_private_ranges && isPrivateOrLiteralIp(host)) {
    return { ok: false, reason: 'private_ip_literal', canonical_host: host };
  }

  // Secret-pattern detection on host + path. Match the offending segment but
  // surface only the pattern name and a redacted path; the secret itself is
  // never persisted.
  if (config.secret_pattern_reject) {
    for (const pattern of SECRET_PATTERNS) {
      const target = `${host}${path}${parsed.search}`;
      const m = pattern.regex.exec(target);
      if (m) {
        return {
          ok: false,
          reason: 'suspicious_url_pattern',
          matched_pattern: pattern.name,
          canonical_host: host,
          canonical_path_redacted: redactSecretInPath(path, pattern),
        };
      }
    }
  }

  // Allowlist match on the canonical host. Empty allowlist → reject all.
  if (config.http_allowlist.length === 0 || !matchesAllowlist(host, config.http_allowlist)) {
    return { ok: false, reason: 'allowlist_miss', canonical_host: host };
  }

  // Build the canonical URI: scheme://host[:port]/path[?query][#fragment]
  const port = parsed.port ? `:${parsed.port}` : '';
  let canonical = `${scheme}://${host}${port}${path}`;
  if (!config.strip_query && parsed.search) canonical += parsed.search;
  if (!config.strip_fragment && parsed.hash) canonical += parsed.hash;

  return {
    ok: true,
    canonical_uri: canonical,
    canonical_host: host,
    canonical_path: path,
    scheme,
  };
}

function matchesAllowlist(host: string, patterns: string[]): boolean {
  return micromatch.isMatch(host, patterns);
}

/**
 * Detect whether a hostname (as produced by URL.hostname) is a private,
 * loopback, link-local, or otherwise non-routable IP literal — including
 * decimal/octal/hex IPv4 forms and IPv6 literal addresses.
 */
function isPrivateOrLiteralIp(host: string): boolean {
  // IPv6 literal — URL.hostname returns it wrapped in [..]; some platforms
  // strip the brackets (Node's URL does). Accept both.
  if (host.startsWith('[') && host.endsWith(']')) {
    return isPrivateIpv6(host.slice(1, -1));
  }
  if (host.includes(':')) {
    return isPrivateIpv6(host);
  }

  // Try to parse as a numeric IPv4 (incl. decimal/octal/hex shorthand).
  const ipv4 = parseFlexibleIpv4(host);
  if (ipv4 !== null) return isPrivateIpv4(ipv4);

  // Hostname that's not an IP literal — let DNS resolution catch it later.
  return false;
}

function parseFlexibleIpv4(host: string): [number, number, number, number] | null {
  // Single-integer form (e.g. "2130706433" = 127.0.0.1).
  if (/^\d+$/.test(host)) {
    const n = Number.parseInt(host, 10);
    if (n < 0 || n > 0xFFFFFFFF) return null;
    return [
      (n >>> 24) & 0xff,
      (n >>> 16) & 0xff,
      (n >>> 8) & 0xff,
      n & 0xff,
    ];
  }

  // Dotted form: octets may be decimal, hex (0x...), or octal (0...).
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    let n: number;
    if (p === '') return null;
    if (/^0x[0-9a-fA-F]+$/.test(p)) {
      n = Number.parseInt(p.slice(2), 16);
    } else if (/^0[0-7]+$/.test(p)) {
      n = Number.parseInt(p, 8);
    } else if (/^\d+$/.test(p)) {
      n = Number.parseInt(p, 10);
    } else {
      return null;
    }
    if (!Number.isFinite(n) || n < 0 || n > 255) return null;
    out.push(n);
  }
  return out as [number, number, number, number];
}

export function isPrivateIpv4(ip: [number, number, number, number]): boolean {
  const [a, b] = ip;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true; // multicast + reserved
  return false;
}

export function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true;
  if (lower === '::') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local fc00::/7
  if (lower.startsWith('ff')) return true; // multicast
  // IPv4-mapped: ::ffff:a.b.c.d
  const v4mapped = /^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/i.exec(lower);
  if (v4mapped) {
    return isPrivateIpv4([
      Number.parseInt(v4mapped[1], 10),
      Number.parseInt(v4mapped[2], 10),
      Number.parseInt(v4mapped[3], 10),
      Number.parseInt(v4mapped[4], 10),
    ]);
  }
  return false;
}

function redactSecretInPath(path: string, pattern: { name: SecretPatternName; regex: RegExp }): string {
  return path.replace(pattern.regex, `[secret-pattern:${pattern.name}]`);
}
