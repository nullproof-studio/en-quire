// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { extname } from 'node:path';
import type { SectionNode, SectionAddress } from '../shared/types.js';
import { ValidationError } from '../shared/errors.js';
import type { OpsStrategy, ParserCapabilities } from './ops-strategy.js';

/**
 * A raw cross-document reference produced by a parser's link extractor,
 * before en-core resolves it against the index of known files.
 *
 * - `target_path` is whatever appears in the link literal (relative path,
 *   wiki name, frontmatter string). Resolution to a real `target_file` is
 *   the indexer's job.
 * - `target_section` is the URL fragment / wiki section, if present.
 * - `context` is short prose around the link, useful for disambiguation.
 */
export interface RawLink {
  source_section: string | null;
  target_path: string;
  target_section: string | null;
  relationship: 'references' | 'implements' | 'supersedes' | 'see_also';
  context: string | null;
  /** True when the parser knows the target is already a fully-qualified, root-prefixed indexed path. */
  prefixed?: boolean;
}

/**
 * Common interface for document parsers.
 * Each parser produces SectionNode[] with byte offsets from raw content,
 * plus an ops strategy that captures any format-specific rendering logic
 * needed by section-ops (heading syntax, level adjustment, etc.).
 */
export interface DocumentParser {
  /** File extensions this parser handles (e.g., ['.md', '.mdx']) */
  readonly extensions: string[];
  /** Format-specific rendering logic used by section-ops */
  readonly ops: OpsStrategy;
  /** Which capabilities this parser supports (e.g. TOC generation) */
  readonly capabilities: ParserCapabilities;
  /** Parse raw content into a section tree with byte offsets */
  parse(content: string): SectionNode[];
  /** Parse a section address string for this format */
  parseAddress(raw: string): SectionAddress;
  /** Validate content and return warnings (empty array = valid) */
  validate(content: string): string[];
  /**
   * Optional: extract cross-document links from `content`. Parsers that
   * don't implement this contribute nothing to the link index — formats
   * without a link concept (e.g. JSONL records) should skip it.
   */
  extractLinks?(content: string): RawLink[];
}

class ParserRegistry {
  private parsers: DocumentParser[] = [];
  private extensionMap = new Map<string, DocumentParser>();

  register(parser: DocumentParser): void {
    this.parsers.push(parser);
    for (const ext of parser.extensions) {
      this.extensionMap.set(ext.toLowerCase(), parser);
    }
  }

  getParser(filePath: string): DocumentParser {
    const ext = extname(filePath).toLowerCase();
    const parser = this.extensionMap.get(ext);
    if (!parser) {
      const supported = this.supportedExtensions().join(', ');
      throw new ValidationError(
        `Unsupported file format "${ext}". Supported extensions: ${supported}`,
      );
    }
    return parser;
  }

  supportedExtensions(): string[] {
    return [...this.extensionMap.keys()];
  }

  /** Return extensions whose parser declares the given capability. */
  extensionsSupporting(capability: keyof ParserCapabilities): string[] {
    const result: string[] = [];
    for (const [ext, parser] of this.extensionMap) {
      if (parser.capabilities[capability]) result.push(ext);
    }
    return result;
  }
}

export const parserRegistry = new ParserRegistry();
