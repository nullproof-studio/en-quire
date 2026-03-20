// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { PathTraversalError, NotFoundError } from './errors.js';
import { decodeAndNormalise, normaliseOutbound } from '../document/encoding.js';
import type { EncodingInfo, LineEnding } from './types.js';

/**
 * Resolve a relative file path against the document root,
 * ensuring it doesn't escape via traversal.
 *
 * Security checks:
 * 1. Null byte injection — rejected outright
 * 2. Path traversal — resolved path must remain within document root
 * 3. Symlink escape — if target exists and is a symlink, its real path must be within root
 */
export function safePath(documentRoot: string, relativePath: string): string {
  // Reject null bytes (can bypass path checks in some environments)
  if (relativePath.includes('\0')) {
    throw new PathTraversalError(relativePath);
  }

  const resolved = resolve(documentRoot, relativePath);
  const rel = relative(documentRoot, resolved);

  if (rel.startsWith('..') || resolve(documentRoot, rel) !== resolved) {
    throw new PathTraversalError(relativePath);
  }

  // If the target exists, resolve symlinks and verify the real path is still within root
  if (existsSync(resolved)) {
    try {
      const realPath = realpathSync(resolved);
      const realRoot = realpathSync(documentRoot);
      const realRel = relative(realRoot, realPath);
      if (realRel.startsWith('..')) {
        throw new PathTraversalError(relativePath);
      }
    } catch (err) {
      if (err instanceof PathTraversalError) throw err;
      // If realpath fails for other reasons, let the downstream operation handle it
    }
  }

  return resolved;
}

/**
 * Read a markdown file, validate encoding, and return normalised content.
 */
export function readDocument(
  documentRoot: string,
  relativePath: string,
): { content: string; encoding: EncodingInfo; absolutePath: string } {
  const absolutePath = safePath(documentRoot, relativePath);

  if (!existsSync(absolutePath)) {
    throw new NotFoundError('file', relativePath);
  }

  const buffer = readFileSync(absolutePath);
  const { content, encoding } = decodeAndNormalise(buffer, relativePath);

  return { content, encoding, absolutePath };
}

/**
 * Write a markdown file with appropriate encoding normalisation.
 */
export function writeDocument(
  documentRoot: string,
  relativePath: string,
  content: string,
  lineEnding: LineEnding = '\n',
): string {
  const absolutePath = safePath(documentRoot, relativePath);
  const normalised = normaliseOutbound(content, lineEnding);
  writeFileSync(absolutePath, normalised, 'utf-8');
  return absolutePath;
}

/** Default supported extensions */
const DEFAULT_EXTENSIONS = ['.md', '.mdx', '.yaml', '.yml'];

/**
 * List all document files under a directory (relative to document root).
 * Supports configurable file extensions; defaults to all registered parser formats.
 */
export function listDocumentFiles(
  documentRoot: string,
  scope?: string,
  extensions: string[] = DEFAULT_EXTENSIONS,
): string[] {
  const baseDir = scope ? safePath(documentRoot, scope) : documentRoot;

  if (!existsSync(baseDir) || !statSync(baseDir).isDirectory()) {
    return [];
  }

  const extSet = new Set(extensions.map((e) => e.toLowerCase()));
  const files: string[] = [];
  walkDir(baseDir, documentRoot, files, extSet);
  return files.sort();
}

/** @deprecated Use listDocumentFiles instead */
export const listMarkdownFiles = listDocumentFiles;

function walkDir(dir: string, root: string, result: string[], extensions: Set<string>): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      walkDir(fullPath, root, result, extensions);
    } else if (entry.isFile()) {
      const ext = entry.name.slice(entry.name.lastIndexOf('.'));
      if (extensions.has(ext.toLowerCase())) {
        result.push(relative(root, fullPath));
      }
    }
  }
}
