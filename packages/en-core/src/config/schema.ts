// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';

// `admin` was reserved in earlier drafts but never gated any tool handler
// — `exec` is the real privileged-operation gate. Having an ungated
// permission in the enum is a footgun (operators grant it expecting
// restrictions, nothing happens), so it's been removed.
const PermissionSchema = z.enum([
  'read', 'write', 'propose', 'approve', 'search', 'exec',
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
  endpoint: z.string().optional(),
  model: z.string().optional(),
  dimensions: z.number().int().positive().optional(),
});

const SearchSchema = z.object({
  fulltext: z.boolean().default(true),
  semantic: SemanticSearchSchema.default({}),
  sync_on_start: z.enum(['blocking', 'background']).default('blocking'),
  batch_size: z.number().int().positive().default(500),
});

const LoggingSchema = z.object({
  level: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  dir: z.string().nullable().default(null),
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
});

export type RawConfig = z.input<typeof ConfigSchema>;
export type ValidatedConfig = z.output<typeof ConfigSchema>;
