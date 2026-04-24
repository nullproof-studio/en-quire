// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, relative, join, dirname } from 'node:path';
import { PathTraversalError, NotFoundError } from './errors.js';
import { decodeAndNormalise, normaliseOutbound } from './encoding.js';
import type { EncodingInfo, LineEnding } from './types.js';

/**
 * Resolve a relative file path against the document root,
 * ensuring it doesn't escape via traversal.
 *
 * Security checks:
 * 1. Null byte injection — rejected outright
 * 2. Path traversal — resolved path must remain within document root
 * 3. Symlink escape — the target (or, for new files, the nearest existing
 *    ancestor of the target) must realpath inside the root. Walking to the
 *    nearest existing ancestor is what protects write paths: a symlinked
 *    directory inside the root (e.g. `root/link-dir -> /etc`) would
 *    otherwise let `root/link-dir/new-file.md` land at `/etc/new-file.md`,
 *    because the non-existent target skips realpath entirely.
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

  // Find the nearest existing ancestor — the target itself if it exists,
  // otherwise walk up one directory at a time until we hit something.
  // existsSync follows symlinks, so if an ancestor is a symlinked directory
  // whose target exists, the walk stops there and realpath reveals where
  // the write will actually land.
  let ancestor = resolved;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break; // filesystem root — nothing more to climb
    ancestor = parent;
  }

  try {
    const realAncestor = realpathSync(ancestor);
    const realRoot = realpathSync(documentRoot);
    const realRel = relative(realRoot, realAncestor);
    if (realRel.startsWith('..')) {
      throw new PathTraversalError(relativePath);
    }
  } catch (err) {
    if (err instanceof PathTraversalError) throw err;
    // realpath can fail for other reasons (EACCES, etc) — let the downstream
    // operation surface a meaningful error rather than masking it here.
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
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // Skip directories that can't be read (EPERM, EACCES — e.g. iCloud, protected dirs)
    return;
  }
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
