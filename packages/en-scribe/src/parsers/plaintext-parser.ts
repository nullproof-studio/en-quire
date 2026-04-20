// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { DocumentParser } from '@nullproof-studio/en-core';
import type { SectionNode, SectionAddress } from '@nullproof-studio/en-core';
import { ValidationError, parserRegistry } from '@nullproof-studio/en-core';
import { plaintextStrategy, plaintextCapabilities } from './plaintext-strategy.js';

/**
 * Plain-text parser.
 *
 * Returns a single whole-file pseudo-section so that executeWrite, proposal
 * plumbing, and etag generation all work identically to en-quire. Plain-text
 * files have no addressable structure — `parseAddress` throws, and none of
 * en-scribe's tools attempt to resolve addresses.
 *
 * Registered extensions are the common "obviously plain text" set; en-scribe
 * deployments that need to edit other extensions (e.g. .md as plain text)
 * can configure this explicitly via en-scribe.config.yaml in a later step.
 * If an extension is already claimed by another parser (e.g. .md by en-quire),
 * en-scribe would run in its own process, so there is no cross-binary
 * conflict.
 */
class PlaintextParser implements DocumentParser {
  readonly extensions = ['.txt', '.text', '.log'];
  readonly ops = plaintextStrategy;
  readonly capabilities = plaintextCapabilities;

  parse(content: string): SectionNode[] {
    if (content.length === 0) return [];

    return [{
      heading: {
        text: '__whole',
        level: 0,
        position: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 1, offset: 0 },
        },
      },
      headingStartOffset: 0,
      bodyStartOffset: 0,
      bodyEndOffset: content.length,
      sectionEndOffset: content.length,
      children: [],
      parent: null,
      index: 0,
      depth: 0,
    }];
  }

  parseAddress(_raw: string): SectionAddress {
    throw new ValidationError(
      'Plain-text files have no section structure. Use line-range or anchor tools (text_read, text_replace_range, text_edit) instead of a section address.',
    );
  }

  validate(_content: string): string[] {
    return [];
  }
}

parserRegistry.register(new PlaintextParser());
