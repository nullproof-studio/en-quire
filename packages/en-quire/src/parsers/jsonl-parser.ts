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
 * Append-new-record is idiomatic DOM: doc_insert_section with
 * anchor = "__records" (the synthetic document-root section) and
 * position = "child_end". The root always exists — even for an empty
 * file — so a single call appends regardless of whether the file has
 * zero or N existing records. Middle-insertion uses the same tool with
 * anchor = "[N]" and position = "before" or "after".
 */

/**
 * Heading text for the synthetic document-root section. Exposed so agents
 * can address it directly (e.g. doc_read_section reads the whole file;
 * doc_insert_section with position="child_end" appends a new record).
 */
export const JSONL_ROOT_HEADING = '__records';

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
    const records = parseRecords(content);

    // Always wrap records in a synthetic document-root section at level 0,
    // even when the file is empty. This gives agents a stable parent to
    // anchor doc_insert_section({position: "child_end"}) against for
    // appending a new record — the same idiom as DOM's append-as-child,
    // and the most common jsonl edit pattern.
    const root: SectionNode = {
      heading: {
        text: JSONL_ROOT_HEADING,
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
      children: records,
      parent: null,
      index: 0,
      depth: 0,
    };

    for (let i = 0; i < records.length; i++) {
      records[i].parent = root;
      records[i].index = i;
      records[i].depth = 1;
    }

    return [root];
  }

  parseAddress(raw: string): SectionAddress {
    const trimmed = raw.trim();

    // Index: [5] — translate through the synthetic root so tree walking
    // finds records as root.children[N] while agents keep the flat
    // [N] mental model.
    if (/^\[\d+\]$/.test(trimmed)) {
      const idx = parseInt(trimmed.slice(1, -1), 10);
      return { type: 'index', indices: [0, idx] };
    }

    // JSON-array index. If the first element is 0 (targeting the synthetic
    // root or a path through it), leave as-is; otherwise prepend 0.
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.every((n) => typeof n === 'number')) {
          const indices = parsed[0] === 0 ? parsed : [0, ...parsed];
          return { type: 'index', indices };
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
    // Resolves __records (synthetic root) or a full heading line pasted
    // from doc_outline.
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

/**
 * Scan the content line-by-line and produce one SectionNode per valid record.
 * Blank lines are silently skipped (validate() flags them separately).
 * Malformed lines still produce a section with a best-effort heading so
 * doc_outline isn't left incomplete; parse errors surface through validate().
 */
function parseRecords(content: string): SectionNode[] {
  if (content.length === 0) return [];

  const nodes: SectionNode[] = [];
  let offset = 0;
  let index = 0;
  let lineNumber = 1;

  while (offset < content.length) {
    const nextNewline = content.indexOf('\n', offset);
    const lineEnd = nextNewline === -1 ? content.length : nextNewline;
    const lineContent = content.slice(offset, lineEnd);

    if (lineContent.trim().length === 0) {
      offset = nextNewline === -1 ? content.length : nextNewline + 1;
      lineNumber += 1;
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(lineContent);
    } catch {
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

parserRegistry.register(new JsonlParser());
