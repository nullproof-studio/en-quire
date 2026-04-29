// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { extname } from 'node:path';
import type { SectionNode, SectionAddress } from '../shared/types.js';
import { ValidationError } from '../shared/errors.js';
import type { OpsStrategy, ParserCapabilities } from './ops-strategy.js';

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
