// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { evaluateUrlPolicy } from '@nullproof-studio/en-core';

const DEFAULT = {
  https_only: true,
  http_allowlist: ['*.forbes.com', 'forbes.com', 'example.test', '*.example.test'],
  block_private_ranges: true,
  strip_query: true,
  strip_fragment: true,
  allow_userinfo: false,
  max_path_chars: 2048,
  max_host_chars: 253,
  secret_pattern_reject: true,
};

describe('evaluateUrlPolicy — canonicalisation', () => {
  it('strips querystring and fragment by default', () => {
    const r = evaluateUrlPolicy('https://forbes.com/articles/x?utm=y#section-3', DEFAULT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.canonical_uri).toBe('https://forbes.com/articles/x');
      expect(r.canonical_host).toBe('forbes.com');
      expect(r.canonical_path).toBe('/articles/x');
    }
  });

  it('preserves querystring when strip_query is false', () => {
    const r = evaluateUrlPolicy(
      'https://forbes.com/x?id=42',
      { ...DEFAULT, strip_query: false },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.canonical_uri).toBe('https://forbes.com/x?id=42');
    }
  });

  it('preserves fragment when strip_fragment is false', () => {
    const r = evaluateUrlPolicy(
      'https://forbes.com/x#section',
      { ...DEFAULT, strip_fragment: false },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.canonical_uri).toBe('https://forbes.com/x#section');
    }
  });

  it('lowercases the host but preserves path case', () => {
    const r = evaluateUrlPolicy('https://Forbes.COM/Articles/X', DEFAULT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.canonical_host).toBe('forbes.com');
      expect(r.canonical_path).toBe('/Articles/X');
    }
  });

  it('treats absent path as /', () => {
    const r = evaluateUrlPolicy('https://forbes.com', DEFAULT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.canonical_path).toBe('/');
      expect(r.canonical_uri).toBe('https://forbes.com/');
    }
  });
});

describe('evaluateUrlPolicy — userinfo', () => {
  it('rejects URL with userinfo by default', () => {
    const r = evaluateUrlPolicy('https://user:pass@forbes.com/x', DEFAULT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('userinfo_disallowed');
  });

  it('allows userinfo when allow_userinfo is true', () => {
    const r = evaluateUrlPolicy(
      'https://user@forbes.com/x',
      { ...DEFAULT, allow_userinfo: true },
    );
    expect(r.ok).toBe(true);
  });
});

describe('evaluateUrlPolicy — scheme', () => {
  it('rejects plain http when https_only is true', () => {
    const r = evaluateUrlPolicy('http://forbes.com/x', DEFAULT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('plaintext_http_disallowed');
  });

  it('accepts http when https_only is false (and host allowlisted)', () => {
    const r = evaluateUrlPolicy(
      'http://forbes.com/x',
      { ...DEFAULT, https_only: false },
    );
    expect(r.ok).toBe(true);
  });

  it('rejects unknown schemes', () => {
    const r = evaluateUrlPolicy('ftp://forbes.com/x', DEFAULT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unsupported_scheme');
  });
});

describe('evaluateUrlPolicy — length caps', () => {
  it('rejects when host exceeds max_host_chars', () => {
    const long = 'a'.repeat(254);
    const r = evaluateUrlPolicy(`https://${long}.test/x`, DEFAULT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('host_too_long');
  });

  it('rejects when path exceeds max_path_chars', () => {
    const longPath = '/' + 'a'.repeat(2048);
    const r = evaluateUrlPolicy(`https://forbes.com${longPath}`, DEFAULT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('path_too_long');
  });
});

describe('evaluateUrlPolicy — IP literals (pre-DNS)', () => {
  it('rejects loopback IPv4 literal', () => {
    const r = evaluateUrlPolicy('https://127.0.0.1/x', DEFAULT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('private_ip_literal');
  });

  it('rejects RFC1918 IPv4 literals', () => {
    expect(evaluateUrlPolicy('https://10.0.0.5/x', DEFAULT).ok).toBe(false);
    expect(evaluateUrlPolicy('https://192.168.1.1/x', DEFAULT).ok).toBe(false);
    expect(evaluateUrlPolicy('https://172.16.0.1/x', DEFAULT).ok).toBe(false);
  });

  it('rejects link-local IPv4 (169.254/16)', () => {
    const r = evaluateUrlPolicy('https://169.254.169.254/x', DEFAULT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('private_ip_literal');
  });

  it('rejects decimal IP literal (2130706433 = 127.0.0.1)', () => {
    const r = evaluateUrlPolicy('https://2130706433/x', DEFAULT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('private_ip_literal');
  });

  it('rejects octal IP literal (0177.0.0.1 = 127.0.0.1)', () => {
    const r = evaluateUrlPolicy('https://0177.0.0.1/x', DEFAULT);
    expect(r.ok).toBe(false);
  });

  it('rejects IPv6 loopback [::1]', () => {
    const r = evaluateUrlPolicy('https://[::1]/x', DEFAULT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('private_ip_literal');
  });

  it('rejects IPv6 link-local [fe80::1]', () => {
    const r = evaluateUrlPolicy('https://[fe80::1]/x', DEFAULT);
    expect(r.ok).toBe(false);
  });

  it('rejects IPv6 unique-local [fc00::1]', () => {
    const r = evaluateUrlPolicy('https://[fc00::1]/x', DEFAULT);
    expect(r.ok).toBe(false);
  });

  it('does not block public IPv4 literals when allowlist is empty (allowlist_miss)', () => {
    // 8.8.8.8 (Google DNS) — public IPv4. Not blocked by the private guard,
    // but rejected by the empty allowlist.
    const r = evaluateUrlPolicy('https://8.8.8.8/x', { ...DEFAULT, http_allowlist: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('allowlist_miss');
  });
});

describe('evaluateUrlPolicy — allowlist', () => {
  it('rejects host not in allowlist', () => {
    const r = evaluateUrlPolicy('https://attacker.test/x', DEFAULT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('allowlist_miss');
  });

  it('matches exact host', () => {
    const r = evaluateUrlPolicy('https://forbes.com/x', DEFAULT);
    expect(r.ok).toBe(true);
  });

  it('matches glob pattern *.forbes.com', () => {
    const r = evaluateUrlPolicy('https://www.forbes.com/x', DEFAULT);
    expect(r.ok).toBe(true);
  });

  it('does not match a glob with a different parent', () => {
    const r = evaluateUrlPolicy(
      'https://attacker.com/x',
      { ...DEFAULT, http_allowlist: ['*.forbes.com'] },
    );
    expect(r.ok).toBe(false);
  });

  it('rejects everything when allowlist is empty', () => {
    const r = evaluateUrlPolicy(
      'https://forbes.com/x',
      { ...DEFAULT, http_allowlist: [] },
    );
    expect(r.ok).toBe(false);
  });
});

describe('evaluateUrlPolicy — secret pattern rejection', () => {
  it('rejects an OpenAI-shaped key in the path', () => {
    const r = evaluateUrlPolicy(
      'https://forbes.com/api/sk-abcdef0123456789abcdef0123',
      DEFAULT,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('suspicious_url_pattern');
      expect(r.matched_pattern).toBe('openai-key');
    }
  });

  it('rejects a GitHub PAT in the path', () => {
    const r = evaluateUrlPolicy(
      'https://forbes.com/x/ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789AB',
      DEFAULT,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.matched_pattern).toBe('github-pat');
  });

  it('rejects a Slack token in the path', () => {
    const r = evaluateUrlPolicy(
      'https://forbes.com/x/xoxb-1234567890-abcd',
      DEFAULT,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.matched_pattern).toBe('slack-token');
  });

  it('rejects a JWT-shaped triple in the path', () => {
    const r = evaluateUrlPolicy(
      'https://forbes.com/auth/eyJhbGciOiJIUzI1NiJ9abcdefgh.eyJzdWIiOiIxMjM0NTY3ODkwIn0xx.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      DEFAULT,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.matched_pattern).toBe('jwt');
  });

  it('rejects a long high-entropy hex segment', () => {
    const hex = 'a'.repeat(64);
    const r = evaluateUrlPolicy(
      `https://forbes.com/api/${hex}`,
      DEFAULT,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.matched_pattern).toBe('high-entropy-blob');
  });

  it('does not flag normal short path segments', () => {
    const r = evaluateUrlPolicy(
      'https://forbes.com/articles/anthropic-revenue-2026',
      DEFAULT,
    );
    expect(r.ok).toBe(true);
  });

  it('returns a redacted canonical_path so the secret is not persisted', () => {
    const r = evaluateUrlPolicy(
      'https://forbes.com/api/sk-abcdef0123456789abcdef0123',
      DEFAULT,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.canonical_path_redacted).toBe('/api/[secret-pattern:openai-key]');
      // Confirm the secret itself is not present anywhere in the result
      expect(JSON.stringify(r)).not.toContain('sk-abcdef');
    }
  });

  it('skips the check when secret_pattern_reject is false', () => {
    const r = evaluateUrlPolicy(
      'https://forbes.com/api/sk-abcdef0123456789abcdef0123',
      { ...DEFAULT, secret_pattern_reject: false },
    );
    expect(r.ok).toBe(true);
  });
});

describe('evaluateUrlPolicy — malformed input', () => {
  it('rejects a URL with whitespace', () => {
    const r = evaluateUrlPolicy('https://forbes.com/a b', DEFAULT);
    expect(r.ok).toBe(false);
  });

  it('rejects a URL with a closing bracket in the path (would break parser)', () => {
    const r = evaluateUrlPolicy('https://forbes.com/a]b', DEFAULT);
    expect(r.ok).toBe(false);
  });

  it('rejects an unparseable URL', () => {
    const r = evaluateUrlPolicy('not-a-url-at-all', DEFAULT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_url');
  });
});
