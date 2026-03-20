// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ResolvedRoot } from '../shared/types.js';
import { NotFoundError, ValidationError } from '../shared/errors.js';

export interface ResolvedFile {
  rootName: string;
  root: ResolvedRoot;
  relativePath: string; // path within the root (no prefix)
  prefixedPath: string; // rootName/relativePath (for index keys, display)
}

/**
 * Resolve a file path (potentially prefixed with root name) to a specific root.
 *
 * When there is only one root, bare paths (without prefix) are accepted and
 * auto-prefixed. When there are multiple roots, the root prefix is required.
 */
export function resolveFilePath(
  roots: Record<string, ResolvedRoot>,
  filePath: string,
): ResolvedFile {
  const rootNames = Object.keys(roots);

  if (rootNames.length === 0) {
    throw new ValidationError('No document roots configured.');
  }

  // Try to match a root prefix
  for (const name of rootNames) {
    const prefix = name + '/';
    if (filePath.startsWith(prefix)) {
      const relativePath = filePath.slice(prefix.length);
      if (!relativePath) {
        throw new ValidationError(`File path "${filePath}" is a root, not a file.`);
      }
      return {
        rootName: name,
        root: roots[name],
        relativePath,
        prefixedPath: filePath,
      };
    }
  }

  // No prefix matched — if single root, treat as bare path
  if (rootNames.length === 1) {
    const name = rootNames[0];
    return {
      rootName: name,
      root: roots[name],
      relativePath: filePath,
      prefixedPath: `${name}/${filePath}`,
    };
  }

  throw new NotFoundError(
    'root',
    `Cannot resolve root for "${filePath}". With multiple roots, prefix the path with a root name: ${rootNames.join(', ')}`,
  );
}

/**
 * Resolve a scope string to a root name and scope within that root.
 * Returns null rootName if the scope spans all roots (e.g. "**").
 */
export function resolveScope(
  roots: Record<string, ResolvedRoot>,
  scope?: string,
): { rootName: string | null; scopeWithinRoot: string | undefined } {
  if (!scope || scope === '**') {
    return { rootName: null, scopeWithinRoot: undefined };
  }

  const rootNames = Object.keys(roots);

  for (const name of rootNames) {
    const prefix = name + '/';
    if (scope.startsWith(prefix)) {
      return {
        rootName: name,
        scopeWithinRoot: scope.slice(prefix.length) || undefined,
      };
    }
    if (scope === name) {
      return { rootName: name, scopeWithinRoot: undefined };
    }
  }

  // Single root — treat scope as within that root
  if (rootNames.length === 1) {
    return { rootName: rootNames[0], scopeWithinRoot: scope };
  }

  // Multi root — could be a glob across roots or an invalid root name
  return { rootName: null, scopeWithinRoot: scope };
}
