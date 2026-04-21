// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { DocumentParser } from '@nullproof-studio/en-core';
import type { SectionNode, SectionAddress } from '@nullproof-studio/en-core';
import { parserRegistry } from '@nullproof-studio/en-core';
import { jsonlStrategy, jsonlCapabilities } from './jsonl-strategy.js';

/**
 * JSONL parser.
 *
 * One JSON object per line — the "newline-delimited JSON" format used by
 * ChatML training data, event logs, streaming APIs, and similar
 * record-oriented text files. Each line becomes a flat, level-1 SectionNode
 * so every doc_* tool (read, replace, insert, delete, outline, search,
 * set_value) works against jsonl unchanged.
 *
 * Heading text for each record is built by a generic heuristic that
 * coalesces common identifier fields (name, id, description, title, role,
 * type, kind) into a scannable summary. When none are present it falls
 * back to "<first-key>: <first 15 chars of value>" so the outline is
 * never empty.
 *
 * Append-new-record: no dedicated tool. Use doc_insert_section with
 * anchor = "[N-1]" and position = "after", where N is the record count
 * from doc_outline. If that composite becomes noisy in practice we can
 * add a doc_append_record convenience tool later.
 */

/** Fields tried in order when building a section heading from a JSON record. */
const IDENTIFIER_KEYS = ['name', 'id', 'description', 'title', 'role', 'type', 'kind'];

/** Max chars used from a scalar value in the snippet-fallback branch. */
const FALLBACK_SNIPPET_LENGTH = 15;

/**
 * Build a scannable heading for a parsed jsonl record.
 *
 * Priority:
 * 1. Coalesce any scalar fields from IDENTIFIER_KEYS that are present
 *    → "name · id · description"
 * 2. If any identifier matched AND the record has another scalar-valued
 *    property that might add context (first non-identifier key), append
 *    its first FALLBACK_SNIPPET_LENGTH chars → "user · Hello how are yo"
 * 3. If no identifiers matched, fall back to "<firstKey>: <snippet>"
 * 4. If the record is not a plain object (scalar, array), show a
 *    truncated JSON.stringify
 *
 * The "[index]" prefix is always included so agents can see at a glance
 * how to address each record.
 */
export function buildJsonlHeading(record: unknown, index: number): string {
  const prefix = `[${index}]`;

  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return `${prefix} ${truncate(JSON.stringify(record) ?? 'null', 40)}`;
  }

  const obj = record as Record<string, unknown>;
  const identifierParts: string[] = [];
  for (const key of IDENTIFIER_KEYS) {
    if (key in obj && isScalar(obj[key])) {
      identifierParts.push(formatScalar(obj[key]));
    }
  }

  if (identifierParts.length > 0) {
    // Add the first non-identifier scalar field as a snippet, if present,
    // so ChatML {role, content} shows the content preview after "user".
    const snippet = firstSnippetFromNonIdentifier(obj);
    if (snippet) {
      return `${prefix} ${identifierParts.join(' · ')}: ${snippet}`;
    }
    return `${prefix} ${identifierParts.join(' · ')}`;
  }

  // Fall back to the first own property.
  const keys = Object.keys(obj);
  if (keys.length === 0) return `${prefix} {}`;
  const firstKey = keys[0];
  const snippet = truncate(formatScalar(obj[firstKey]), FALLBACK_SNIPPET_LENGTH);
  return `${prefix} ${firstKey}: ${snippet}`;
}

function firstSnippetFromNonIdentifier(obj: Record<string, unknown>): string | null {
  for (const key of Object.keys(obj)) {
    if (IDENTIFIER_KEYS.includes(key)) continue;
    if (!isScalar(obj[key])) continue;
    return truncate(formatScalar(obj[key]), FALLBACK_SNIPPET_LENGTH);
  }
  return null;
}

function isScalar(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function formatScalar(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

class JsonlParser implements DocumentParser {
  readonly extensions = ['.jsonl', '.ndjson'];
  readonly ops = jsonlStrategy;
  readonly capabilities = jsonlCapabilities;

  parse(content: string): SectionNode[] {
    if (content.length === 0) return [];

    const nodes: SectionNode[] = [];
    let offset = 0;
    let index = 0;
    let lineNumber = 1;

    while (offset < content.length) {
      const nextNewline = content.indexOf('\n', offset);
      const lineEnd = nextNewline === -1 ? content.length : nextNewline;
      const lineContent = content.slice(offset, lineEnd);

      // Skip blank lines silently — they're common in hand-edited jsonl
      // files and shouldn't become phantom sections. validate() warns.
      if (lineContent.trim().length === 0) {
        offset = nextNewline === -1 ? content.length : nextNewline + 1;
        lineNumber += 1;
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(lineContent);
      } catch {
        // Surface via validate(); here, render the raw line as the heading
        // so doc_outline still shows something and the agent can locate it.
        parsed = { __parseError: true, raw: lineContent };
      }

      const headingText = buildJsonlHeading(parsed, index);
      const bodyStart = offset;
      const bodyEnd = lineEnd;
      const sectionEnd = nextNewline === -1 ? content.length : nextNewline + 1;

      nodes.push({
        heading: {
          text: headingText,
          level: 1,
          position: {
            start: { line: lineNumber, column: 1, offset: bodyStart },
            end: { line: lineNumber, column: lineContent.length + 1, offset: bodyEnd },
          },
        },
        headingStartOffset: bodyStart,
        bodyStartOffset: bodyStart,
        bodyEndOffset: bodyEnd,
        sectionEndOffset: sectionEnd,
        children: [],
        parent: null,
        index,
        depth: 0,
      });

      offset = sectionEnd;
      index += 1;
      lineNumber += 1;
    }

    return nodes;
  }

  parseAddress(raw: string): SectionAddress {
    const trimmed = raw.trim();

    // Index: [5]
    if (/^\[\d+\]$/.test(trimmed)) {
      const idx = parseInt(trimmed.slice(1, -1), 10);
      return { type: 'index', indices: [idx] };
    }

    // JSON-array index (e.g. "[0]" in yaml's style, or richer index paths)
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.every((n) => typeof n === 'number')) {
          return { type: 'index', indices: parsed };
        }
      } catch {
        // Fall through
      }
    }

    // Pattern: matches against the rendered heading (e.g. "[*] user*"
    // to pick every user message). Useful with doc_read_section when the
    // caller wants to scan a role.
    if (/[*?]/.test(trimmed)) {
      return { type: 'pattern', pattern: trimmed };
    }

    // Default: text address — matches the full heading text literally.
    // Most jsonl callers will prefer [N] index addressing; this is the
    // fall-through for agents that paste a heading line from doc_outline.
    return { type: 'text', text: trimmed };
  }

  validate(content: string): string[] {
    if (content.trim().length === 0) return [];
    const warnings: string[] = [];
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (line.trim().length === 0) return;
      try {
        JSON.parse(line);
      } catch (err) {
        warnings.push(
          `Line ${i + 1}: JSON parse error — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    });
    return warnings;
  }
}

parserRegistry.register(new JsonlParser());
