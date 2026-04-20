// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import {
  parseDocument,
  isMap,
  isSeq,
  isScalar,
  isAlias,
} from 'yaml';
import type { YAMLMap, YAMLSeq, Pair, Scalar, Node as YAMLNode } from 'yaml';
import type { DocumentParser } from './parser-registry.js';
import type { SectionNode, SectionAddress } from '../shared/types.js';
import { ValidationError } from '../shared/errors.js';
import { parserRegistry } from './parser-registry.js';
import { yamlStrategy, yamlCapabilities } from './yaml-strategy.js';

class YamlParser implements DocumentParser {
  readonly extensions = ['.yaml', '.yml'];
  readonly ops = yamlStrategy;
  readonly capabilities = yamlCapabilities;

  parse(content: string): SectionNode[] {
    if (content.trim().length === 0) return [];

    // Detect multi-document YAML (--- separator after first line)
    if (/\n---\s*\n/.test(content) && content.indexOf('\n---') !== content.lastIndexOf('\n---')) {
      throw new ValidationError(
        'Multi-document YAML is not supported. Split into separate files.',
      );
    }

    const doc = parseDocument(content, { keepSourceTokens: true });

    if (doc.errors.length > 0) {
      throw new ValidationError(
        `YAML parse error: ${doc.errors[0].message}`,
      );
    }

    const root = doc.contents;
    if (!root || !isMap(root)) {
      // Scalar or sequence at root level — no sections to build
      return [];
    }

    return buildYamlTree(root, content, 1, null);
  }

  parseAddress(raw: string): SectionAddress {
    const trimmed = raw.trim();

    // Index addressing still works: [0, 1]
    if (trimmed.startsWith('[') && !trimmed.startsWith("['")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.every((n) => typeof n === 'number')) {
          return { type: 'index', indices: parsed };
        }
      } catch {
        // Not valid JSON index, fall through
      }
    }

    // Path addressing with " > " separator (e.g. "services > api > environment")
    // Works for YAML too — walks the key hierarchy like dot-paths
    if (trimmed.includes(' > ')) {
      return {
        type: 'path',
        segments: trimmed.split(' > ').map((s) => s.trim()),
      };
    }

    // Pattern addressing: contains glob chars
    if (/[*?]/.test(trimmed) && !trimmed.includes('.')) {
      return { type: 'pattern', pattern: trimmed };
    }

    // Dot-path addressing (the primary YAML address format)
    if (trimmed.includes('.') || trimmed.includes('[')) {
      return { type: 'dotpath', segments: parseDotPath(trimmed) };
    }

    // Simple key name — treat as text address
    return { type: 'text', text: trimmed };
  }

  validate(content: string): string[] {
    if (content.trim().length === 0) return [];
    const warnings: string[] = [];
    const doc = parseDocument(content);
    for (const err of doc.errors) {
      warnings.push(`YAML syntax error: ${err.message}`);
    }
    for (const warn of doc.warnings) {
      warnings.push(`YAML warning: ${warn.message}`);
    }
    return warnings;
  }
}

/**
 * Parse a dot-separated key path into segments.
 * Handles bracket notation for dotted keys: services['my.key'].port
 * Handles sequence indices: volumes[0]
 */
function parseDotPath(path: string): string[] {
  const segments: string[] = [];
  let i = 0;

  while (i < path.length) {
    if (path[i] === '[') {
      // Bracket notation
      if (path[i + 1] === "'" || path[i + 1] === '"') {
        // Quoted key: ['my.dotted.key']
        const quote = path[i + 1];
        const end = path.indexOf(`${quote}]`, i + 2);
        if (end === -1) break;
        segments.push(path.slice(i + 2, end));
        i = end + 2;
      } else {
        // Sequence index: [0]
        const end = path.indexOf(']', i);
        if (end === -1) break;
        segments.push(path.slice(i, end + 1)); // Keep as "[0]"
        i = end + 1;
      }
      // Skip trailing dot
      if (i < path.length && path[i] === '.') i++;
    } else {
      // Regular key segment
      let end = i;
      while (end < path.length && path[end] !== '.' && path[end] !== '[') {
        end++;
      }
      if (end > i) {
        segments.push(path.slice(i, end));
      }
      i = end;
      // Skip dot separator
      if (i < path.length && path[i] === '.') i++;
    }
  }

  return segments;
}

/**
 * Build SectionNode[] from a YAMLMap, recursively.
 */
function buildYamlTree(
  map: YAMLMap,
  content: string,
  level: number,
  parent: SectionNode | null,
): SectionNode[] {
  const nodes: SectionNode[] = [];

  for (let idx = 0; idx < map.items.length; idx++) {
    const pair = map.items[idx] as Pair<YAMLNode, YAMLNode | null>;
    const keyNode = pair.key;
    if (!isScalar(keyNode)) continue;

    const keyText = String((keyNode as Scalar).value);
    const keyRange = (keyNode as YAMLNode).range;
    if (!keyRange) continue;

    const valueNode = pair.value;
    const valueRange = valueNode ? (valueNode as YAMLNode).range : null;

    // headingStartOffset: start of the line containing the key
    const headingStartOffset = findLineStart(content, keyRange[0]);

    // bodyStartOffset: after the key (colon + space area, or start of value)
    let bodyStartOffset = valueRange ? valueRange[0] : keyRange[2];

    // Determine section boundaries
    let bodyEndOffset: number;
    let sectionEndOffset: number;

    if (valueNode && (isMap(valueNode) || isSeq(valueNode))) {
      // Container: in YAML, children ARE the content (unlike markdown where
      // body text and child headings are separate). bodyEndOffset must equal
      // sectionEndOffset so that replaceSection replaces the full subtree.
      sectionEndOffset = valueRange![2];
      bodyEndOffset = sectionEndOffset;
      // Body starts at the line start of the value, not at the first character,
      // so that replaceSection doesn't include leftover indentation from `before`.
      bodyStartOffset = findLineStart(content, valueRange![0]);
    } else {
      // Scalar or null value: no children
      sectionEndOffset = valueRange ? valueRange[2] : keyRange[2];
      bodyEndOffset = sectionEndOffset;
    }

    // Build position for heading
    const startLine = countLines(content, headingStartOffset);
    const startCol = headingStartOffset - content.lastIndexOf('\n', headingStartOffset - 1);

    const node: SectionNode = {
      heading: {
        text: keyText,
        level,
        position: {
          start: { line: startLine, column: startCol, offset: headingStartOffset },
          end: { line: startLine, column: startCol + keyText.length, offset: keyRange[1] },
        },
      },
      headingStartOffset,
      bodyStartOffset,
      bodyEndOffset,
      sectionEndOffset,
      children: [],
      parent,
      index: idx,
      depth: parent ? parent.depth + 1 : 0,
    };

    // Recurse into nested structures
    if (valueNode && isMap(valueNode)) {
      node.children = buildYamlTree(valueNode, content, level + 1, node);
    } else if (valueNode && isSeq(valueNode)) {
      node.children = buildYamlSeqChildren(valueNode as YAMLSeq, content, level + 1, node);
    }

    nodes.push(node);
  }

  return nodes;
}

/**
 * Build SectionNode[] for items in a YAML sequence.
 */
function buildYamlSeqChildren(
  seq: YAMLSeq,
  content: string,
  level: number,
  parent: SectionNode,
): SectionNode[] {
  const nodes: SectionNode[] = [];

  for (let idx = 0; idx < seq.items.length; idx++) {
    const item = seq.items[idx] as YAMLNode;
    const range = item?.range;
    if (!range) continue;

    const headingStartOffset = findLineStart(content, range[0]);
    const startLine = countLines(content, headingStartOffset);
    const startCol = headingStartOffset - content.lastIndexOf('\n', headingStartOffset - 1);

    const node: SectionNode = {
      heading: {
        text: `[${idx}]`,
        level,
        position: {
          start: { line: startLine, column: startCol, offset: headingStartOffset },
          end: { line: startLine, column: startCol + `[${idx}]`.length, offset: range[0] },
        },
      },
      headingStartOffset,
      bodyStartOffset: range[0],
      bodyEndOffset: range[2],
      sectionEndOffset: range[2],
      children: [],
      parent,
      index: idx,
      depth: parent.depth + 1,
    };

    // If the sequence item is a map, recurse
    if (isMap(item)) {
      node.children = buildYamlTree(item, content, level + 1, node);
      if (node.children.length > 0) {
        node.bodyEndOffset = node.children[0].headingStartOffset;
      }
    }

    nodes.push(node);
  }

  return nodes;
}

function findLineStart(content: string, offset: number): number {
  const lastNewline = content.lastIndexOf('\n', offset - 1);
  return lastNewline === -1 ? 0 : lastNewline + 1;
}

function countLines(content: string, offset: number): number {
  let lines = 1;
  for (let i = 0; i < offset; i++) {
    if (content[i] === '\n') lines++;
  }
  return lines;
}

parserRegistry.register(new YamlParser());
