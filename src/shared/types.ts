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

export type SectionAddress = TextAddress | PathAddress | IndexAddress | PatternAddress;

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
  has_children: boolean;
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
export type Permission = 'read' | 'write' | 'propose' | 'approve' | 'search' | 'admin' | 'exec';

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

/** Tool context passed to all tool handlers */
export interface ToolContext {
  config: ResolvedConfig;
  documentRoot: string;
  caller: CallerIdentity;
  db: unknown; // better-sqlite3 Database (typed loosely to avoid import here)
  git: unknown | null; // GitOperations or null in lite mode
}

/** Resolved (validated + defaults applied) configuration */
export interface ResolvedConfig {
  document_root: string;
  transport: 'stdio' | 'streamable-http';
  port: number;
  search: {
    fulltext: boolean;
    sync_on_start: 'blocking' | 'background';
    batch_size: number;
    semantic: {
      enabled: boolean;
      endpoint?: string;
      model?: string;
      dimensions?: number;
    };
  };
  logging: {
    level: 'error' | 'warn' | 'info' | 'debug';
    dir: string | null;
  };
  git: {
    enabled: boolean | null; // null = auto-detect
    auto_commit: boolean;
    remote: string | null;
    pr_hook: string | null;
  };
  callers: Record<string, CallerConfig>;
}

/** Caller configuration from config file */
export interface CallerConfig {
  key?: string;
  scopes: CallerScope[];
}
