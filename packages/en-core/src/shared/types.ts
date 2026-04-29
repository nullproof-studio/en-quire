// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { Position } from 'unist';

/**
 * A node in the section tree built from heading hierarchy.
 * References positions in the original markdown string.
 */
export interface SectionNode {
  heading: {
    text: string;
    level: number; // 1-6
    position: Position;
  };
  /** Byte offset in original string where section body begins (after heading line) */
  bodyStartOffset: number;
  /** Byte offset where section body ends (before next heading of same/higher level) */
  bodyEndOffset: number;
  /** Offset where the heading line starts */
  headingStartOffset: number;
  /** Offset where the entire section ends (including children) */
  sectionEndOffset: number;
  children: SectionNode[];
  parent: SectionNode | null;
  /** Position among siblings (0-indexed) */
  index: number;
  /** Depth from root (0-indexed) */
  depth: number;
}

/** Heading text address: exact match on heading content */
export interface TextAddress {
  type: 'text';
  text: string;
}

/** Hierarchical path address: "Parent > Child > Grandchild" */
export interface PathAddress {
  type: 'path';
  segments: string[];
}

/** Positional index address: [0, 1, 0] */
export interface IndexAddress {
  type: 'index';
  indices: number[];
}

/** Glob pattern address: "1.1*" or "Check*" */
export interface PatternAddress {
  type: 'pattern';
  pattern: string;
}

/** Dot-separated key path address for YAML: "services.api.environment" */
export interface DotPathAddress {
  type: 'dotpath';
  segments: string[];
}

export type SectionAddress = TextAddress | PathAddress | IndexAddress | PatternAddress | DotPathAddress;

/** Position for inserting a new section relative to an anchor */
export type InsertPosition = 'before' | 'after' | 'child_start' | 'child_end';

/** Entry in a document outline */
export interface OutlineEntry {
  level: number;
  text: string;
  path: string;
  line_start: number;
  line_end: number;
  char_count: number;
  /** Word count for prose content. Omitted for non-prose formats (e.g. YAML). */
  word_count?: number;
  has_children: boolean;
  /** Whether the section has its own body text (vs being a structural container) */
  has_content: boolean;
  /** First N characters of section body text (only when include_preview is true) */
  preview?: string;
}

/** Search result entry */
export interface SearchResult {
  file: string;
  section_path: string;
  section_heading: string;
  section_level: number;
  snippet: string;
  score: number;
  line_start: number;
  line_end: number;
  breadcrumb: string[];
}

/** Find-replace match for preview mode */
export interface FindReplaceMatch {
  id: number;
  line: number;
  section_path: string;
  context: string;
  in_code_block: boolean;
}

/** Options for find-replace operations */
export interface FindReplaceOptions {
  regex?: boolean;
  flags?: string;
  preview?: boolean;
  apply_matches?: number[];
  expected_count?: number;
}

/** Result of a write operation */
export interface WriteResult {
  success: boolean;
  file: string;
  section?: string;
  mode: 'write' | 'propose';
  branch?: string;
  commit?: string;
  diff?: string;
}

/** Line ending style detected in a document */
export type LineEnding = '\n' | '\r\n' | '\r';

/** Detected encoding metadata for a file */
export interface EncodingInfo {
  hasBom: boolean;
  lineEnding: LineEnding;
}

/** Permission types for RBAC */
export type Permission =
  | 'read'
  | 'write'
  | 'propose'
  | 'approve'
  | 'search'
  | 'exec'
  // Citation permissions. `cite` covers en-quire managed paths and file://
  // sources. `cite_web` is required additionally for https?:// — the egress
  // capability is gated separately so a deployer can grant local-only
  // citation without enabling web fetch.
  | 'cite'
  | 'cite_web';

/** Caller identity resolved from transport context */
export interface CallerIdentity {
  id: string;
  scopes: CallerScope[];
}

/** A permission scope for a caller */
export interface CallerScope {
  path: string;
  permissions: Permission[];
}

/** Git configuration per document root */
export interface RootGitConfig {
  enabled: boolean | null; // null = auto-detect
  auto_commit: boolean;
  remote: string | null;
  pr_hook: string | null;
  pr_hook_secret: string | null; // HMAC-SHA256 secret for webhook-mode pr_hook signing
  default_branch: string | null; // null = detect from origin HEAD / local branches
  push_proposals: boolean; // push proposal branches to `remote` after commit
}

/** A resolved document root */
export interface ResolvedRoot {
  name: string;
  path: string; // absolute path
  description?: string;
  git: RootGitConfig;
}

/** Resolved (validated + defaults applied) configuration */
export interface ResolvedConfig {
  document_roots: Record<string, ResolvedRoot>;
  database: string; // absolute path to .enquire.db
  transport: 'stdio' | 'streamable-http';
  port: number;
  listen_host: string; // Interface to bind the HTTP server to (default 127.0.0.1)
  search: {
    sync_on_start: 'blocking' | 'background';
    batch_size: number;
    semantic: {
      enabled: boolean;
      endpoint?: string;
      model?: string;
      dimensions?: number;
      api_key?: string | null;
      api_key_env?: string | null;
    };
  };
  logging: {
    level: 'error' | 'warn' | 'info' | 'debug';
    dir: string | null;
  };
  callers: Record<string, CallerConfig>;
  require_read_before_write: boolean;
  citation: ResolvedCitationConfig;
}

/**
 * Citation feature config — opt-in. With `enabled: false` (default) the
 * doc_cite and doc_cite_reverify tools refuse to run. Web citation is also
 * gated by an empty `fetch.http_allowlist` (no-op default) and the
 * `cite_web` permission, both of which must be explicitly granted.
 */
export interface ResolvedCitationConfig {
  enabled: boolean;
  section_heading: string;
  section_position: string;
  web_appends_propose: boolean;
  fetch: {
    https_only: boolean;
    http_allowlist: string[];
    block_private_ranges: boolean;
    allowed_content_types: string[];
    timeout_ms: number;
    max_bytes: number;
    max_redirects: number;
    decompression_factor: number;
    strip_query: boolean;
    strip_fragment: boolean;
    allow_userinfo: boolean;
    max_path_chars: number;
    max_host_chars: number;
    secret_pattern_reject: boolean;
  };
  rate_limit: {
    external_per_minute: number;
  };
}

/** Caller configuration from config file */
export interface CallerConfig {
  key?: string;
  scopes: CallerScope[];
}
