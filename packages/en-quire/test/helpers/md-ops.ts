// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
/**
 * Markdown-flavoured wrappers around core section-ops.
 *
 * Core's section-ops-core.ts requires an OpsStrategy argument; bakes in the
 * markdown strategy for tests that exercise md behaviour. Production callers
 * (tool handlers) obtain ops from parser.ops.
 */
import type { SectionAddress, SectionNode, InsertPosition } from '@nullproof-studio/en-core';
import {
  replaceSection as _replaceSection,
  insertSection as _insertSection,
  appendToSection as _appendToSection,
  moveSection as _moveSection,
  setValue as _setValue,
} from '@nullproof-studio/en-core';
import { markdownStrategy } from '../../src/parsers/markdown-strategy.js';

export function replaceSection(
  markdown: string,
  tree: SectionNode[],
  address: SectionAddress,
  content: string,
  replaceHeading: boolean | string = false,
): string {
  return _replaceSection(markdown, tree, address, content, replaceHeading, markdownStrategy);
}

export function insertSection(
  markdown: string,
  tree: SectionNode[],
  anchor: SectionAddress,
  position: InsertPosition,
  heading: string,
  content: string,
  level?: number,
): string {
  return _insertSection(markdown, tree, anchor, position, heading, content, markdownStrategy, level);
}

export function appendToSection(
  markdown: string,
  tree: SectionNode[],
  address: SectionAddress,
  content: string,
): string {
  return _appendToSection(markdown, tree, address, content, markdownStrategy);
}

export function moveSection(
  markdown: string,
  tree: SectionNode[],
  source: SectionAddress,
  anchor: SectionAddress,
  position: InsertPosition,
): string {
  return _moveSection(markdown, tree, source, anchor, position, markdownStrategy);
}

export function setValue(
  markdown: string,
  tree: SectionNode[],
  address: SectionAddress,
  value: string,
): string {
  return _setValue(markdown, tree, address, value, markdownStrategy);
}
