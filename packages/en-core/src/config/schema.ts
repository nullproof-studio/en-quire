// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';

// `admin` was reserved in earlier drafts but never gated any tool handler
// — `exec` is the real privileged-operation gate. Having an ungated
// permission in the enum is a footgun (operators grant it expecting
// restrictions, nothing happens), so it's been removed.
const PermissionSchema = z.enum([
  'read', 'write', 'propose', 'approve', 'search', 'exec',
  // Citation permissions. cite ⇒ local + en-quire managed sources; cite_web
  // ⇒ additionally required for https?:// (network egress is gated
  // independently so a deployer can grant local-only citation).
  'cite', 'cite_web',
]);

const CallerScopeSchema = z.object({
  path: z.string(),
  permissions: z.array(PermissionSchema),
});

const CallerConfigSchema = z.object({
  key: z.string().optional(),
  scopes: z.array(CallerScopeSchema),
});

const SemanticSearchSchema = z.object({
  enabled: z.boolean().default(false),
  // Base URL of an OpenAI-compatible embeddings server (e.g.
  // "https://api.openai.com/v1", "http://localhost:1234/v1"). The client
  // appends "/embeddings" — do not include the trailing path.
  endpoint: z.string().optional(),
  model: z.string().optional(),
  dimensions: z.number().int().positive().optional(),
  // Authorisation: literal API key or env var name to read at startup.
  // Prefer api_key_env so secrets don't sit in committed config. When
  // both are set, the env var wins.
  api_key: z.string().nullable().default(null),
  api_key_env: z.string().nullable().default(null),
});

const SearchSchema = z.object({
  semantic: SemanticSearchSchema.default({}),
  sync_on_start: z.enum(['blocking', 'background']).default('blocking'),
  batch_size: z.number().int().positive().default(500),
}).passthrough();
// `passthrough` keeps Zod from erroring on unrecognised keys —
// `search.fulltext` was a stale toggle that never gated any code path,
// so it was removed in v0.3. Operators with `fulltext: false` in old
// configs see no behaviour change (FTS was always on), and Zod's
// passthrough mode silently accepts the legacy key without breaking
// startup.

const LoggingSchema = z.object({
  level: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  dir: z.string().nullable().default(null),
});

// Citation feature config. The whole feature is opt-in: `enabled: false` is
// the default. Web citation is independently gated — leaving
// `fetch.http_allowlist` empty (the default) means no external host can be
// cited even if `cite_web` is granted. See README §Citations for the full
// security posture.
const CitationFetchSchema = z.object({
  https_only: z.boolean().default(true),
  http_allowlist: z.array(z.string()).default([]),
  block_private_ranges: z.boolean().default(true),
  allowed_content_types: z.array(z.string()).default([
    'text/html',
    'text/plain',
    'text/markdown',
    'application/json',
    'application/xhtml+xml',
  ]),
  timeout_ms: z.number().int().positive().default(10_000),
  max_bytes: z.number().int().positive().default(5_000_000),
  max_redirects: z.number().int().nonnegative().default(3),
  decompression_factor: z.number().int().positive().default(5),
  strip_query: z.boolean().default(true),
  strip_fragment: z.boolean().default(true),
  allow_userinfo: z.boolean().default(false),
  max_path_chars: z.number().int().positive().default(2048),
  max_host_chars: z.number().int().positive().default(253),
  secret_pattern_reject: z.boolean().default(true),
});

const CitationRateLimitSchema = z.object({
  external_per_minute: z.number().int().nonnegative().default(30),
});

const CitationSchema = z.object({
  enabled: z.boolean().default(false),
  section_heading: z.string().default('Citations'),
  section_position: z.string().default('end'),
  web_appends_propose: z.boolean().default(false),
  fetch: CitationFetchSchema.default({}),
  rate_limit: CitationRateLimitSchema.default({}),
});

const RootGitSchema = z.object({
  enabled: z.boolean().nullable().default(null), // null = auto-detect
  auto_commit: z.boolean().default(true),
  remote: z.string().nullable().default(null),
  pr_hook: z.string().nullable().default(null),
  // HMAC-SHA256 secret used to sign webhook-mode pr_hook bodies (sent as the
  // `X-EnQuire-Signature: sha256=<hex>` header). Ignored for command-mode hooks.
  // Prefer env interpolation over a literal value in committed config.
  pr_hook_secret: z.string().nullable().default(null),
  default_branch: z.string().nullable().default(null), // null = detect from origin HEAD / local branches
  push_proposals: z.boolean().default(false), // push proposal branches to `remote` after commit
});

const DocumentRootSchema = z.object({
  path: z.string(),
  description: z.string().optional(),
  git: RootGitSchema.default({}),
});

export const ConfigSchema = z.object({
  document_roots: z.record(z.string(), DocumentRootSchema),
  database: z.string().optional(), // Path to .enquire.db; defaults to next to config file
  transport: z.enum(['stdio', 'streamable-http']).default('stdio'),
  port: z.number().int().positive().default(3100),
  // Interface to bind the HTTP server to. Defaults to loopback so an
  // operator who flips `transport: streamable-http` doesn't accidentally
  // serve on a LAN. Set to "0.0.0.0" only if you intend network exposure —
  // Bearer auth is required in that case (enforced at startup).
  listen_host: z.string().default('127.0.0.1'),
  search: SearchSchema.default({}),
  logging: LoggingSchema.default({}),
  callers: z.record(z.string(), CallerConfigSchema).default({}),
  require_read_before_write: z.boolean().default(true),
  citation: CitationSchema.default({}),
});

export type RawConfig = z.input<typeof ConfigSchema>;
export type ValidatedConfig = z.output<typeof ConfigSchema>;
