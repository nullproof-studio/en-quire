// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { extname } from 'node:path';
import type { SectionNode, SectionAddress } from '../shared/types.js';
import { ValidationError } from '../shared/errors.js';

/**
 * Common interface for document parsers.
 * Each parser produces SectionNode[] with byte offsets from raw content.
 */
export interface DocumentParser {
  /** File extensions this parser handles (e.g., ['.md', '.mdx']) */
  readonly extensions: string[];
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
}

export const parserRegistry = new ParserRegistry();
