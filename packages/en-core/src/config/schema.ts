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

// Role-based access policy. A binding carries exactly one selector
// (user | domain | idp_group | idp_role | local_group) plus the roles it
// grants. The single-selector rule is enforced here; cross-references
// (roles/local_groups/default_role must exist) are validated in the loader
// where the whole policy is in hand.
const SELECTOR_KEYS = ['user', 'domain', 'idp_group', 'idp_role', 'local_group'] as const;

const RoleBindingSchema = z.object({
  user: z.string().optional(),
  domain: z.string().optional(),
  idp_group: z.string().optional(),
  idp_role: z.string().optional(),
  local_group: z.string().optional(),
  roles: z.array(z.string()).min(1),
}).refine(
  (b) => SELECTOR_KEYS.filter((k) => b[k] !== undefined).length === 1,
  { message: 'each binding must set exactly one selector (user | domain | idp_group | idp_role | local_group)' },
);

// OAuth provider trusted for token validation under `auth.mode: oauth-external`.
// `audience` MUST match this server's resource identifier — it is what stops a
// token minted for another service being replayed here. `subject_claim` selects
// the identity; the optional *_claim fields select group/role/domain facts when
// the IdP supplies them (corporate directories do; consumer Google does not).
const OAuthProviderSchema = z.object({
  issuer: z.string(),
  jwks_uri: z.string().optional(), // derived from issuer's discovery doc when omitted
  audience: z.string(),
  algorithms: z.array(z.string()).default(['RS256']),
  subject_claim: z.string().default('sub'),
  groups_claim: z.string().optional(),
  roles_claim: z.string().optional(),
  domain_claim: z.string().optional(), // e.g. Google Workspace "hd"
});

// Authentication backend selector. `bearer` (default) keeps the static
// pre-shared-key path. `oauth-external` makes en-quire an OAuth Resource Server:
// it validates JWT access tokens against one or more trusted providers and maps
// the verified identity to scopes via the `rbac` policy. Multiple providers are
// supported concurrently (a request authenticates against any of them).
const AuthSchema = z.object({
  mode: z.enum(['bearer', 'oauth-external']).default('bearer'),
  resource: z.string().optional(), // canonical RS URL advertised in discovery + expected as aud
  providers: z.array(OAuthProviderSchema).default([]),
});

const RbacSchema = z.object({
  roles: z.record(z.string(), z.array(CallerScopeSchema)).default({}),
  local_groups: z.record(z.string(), z.array(z.string())).default({}),
  bindings: z.array(RoleBindingSchema).default([]),
  default_role: z.string().nullable().default(null),
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
// so it was removed in v0.3. Operators with `fulltext` in their config
// get an explicit deprecation warning at load time (see
// warnLegacyConfigKeys in loader.ts) so the no-op key doesn't quietly
// linger; passthrough only handles the parse, the warning handles the
// operator-visibility side.

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
  // Append an Obsidian block-ID (`^cite-{N}`) to each reference line so
  // `[[#^cite-N]]` self-links resolve in Obsidian. Off by default — the
  // suffix renders literally in non-Obsidian markdown viewers.
  obsidian_block_ids: z.boolean().default(false),
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
  rbac: RbacSchema.default({}),
  auth: AuthSchema.default({}),
});

export type RawConfig = z.input<typeof ConfigSchema>;
export type ValidatedConfig = z.output<typeof ConfigSchema>;
