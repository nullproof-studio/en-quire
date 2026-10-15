// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ResolvedRoot } from '../shared/types.js';
import { NotFoundError, ValidationError } from '../shared/errors.js';
import { rankByLevenshtein } from '../shared/levenshtein.js';

const ROOT_CANDIDATE_LIMIT = 20;
const ROOT_FORMAT_HINT =
  'With multiple roots, prefix the path with a root name (e.g. "rootname/path/to/file.md"), '
  + 'or pass an absolute path inside a configured root.';

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

  if (isAbsolute(filePath)) {
    return resolveAbsolutePath(roots, filePath);
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

  const wouldBeRoot = filePath.split('/')[0] || filePath;
  const candidates = rankByLevenshtein(wouldBeRoot, rootNames, ROOT_CANDIDATE_LIMIT);
  throw new NotFoundError('root', filePath, candidates, ROOT_FORMAT_HINT);
}

/**
 * Canonical forms of an absolute path: as given (normalised, so `..` is
 * collapsed) and with symlinks resolved. The target may not exist yet
 * (doc_create), so realpath the nearest existing ancestor and re-append the
 * rest. Both forms are kept so a root configured via a symlink still matches
 * a real path, and vice versa.
 */
function pathForms(p: string): string[] {
  const normalised = resolve(p);
  let ancestor = normalised;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) {
    ancestor = dirname(ancestor);
  }
  try {
    const real = join(realpathSync(ancestor), relative(ancestor, normalised));
    return real === normalised ? [normalised] : [normalised, real];
  } catch {
    return [normalised];
  }
}

/**
 * Find the configured root containing an absolute filesystem path (#152).
 * Only paths inside a root are accepted — this is a convenience for callers
 * that hold filesystem paths, never a way to address arbitrary files.
 * Containment is by whole path segment (`/srv/spec` does not contain
 * `/srv/spec-local/x.md`) and the deepest root wins when roots nest. Returns
 * the path relative to that root in `/` form (empty for the root itself).
 * The rejection names roots but not their filesystem paths.
 */
function matchAbsoluteToRoot(
  roots: Record<string, ResolvedRoot>,
  absPath: string,
): { name: string; rel: string } {
  const inputForms = pathForms(absPath);
  let best: { name: string; rel: string; depth: number } | undefined;

  for (const [name, root] of Object.entries(roots)) {
    for (const rootForm of pathForms(root.path)) {
      for (const inputForm of inputForms) {
        const rel = relative(rootForm, inputForm);
        if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
        if (!best || rootForm.length > best.depth) {
          best = { name, rel, depth: rootForm.length };
        }
      }
    }
  }

  if (!best) {
    throw new ValidationError(
      `Path "${absPath}" is not inside any configured root. `
      + `Configured roots: ${Object.keys(roots).join(', ')}. ${ROOT_FORMAT_HINT}`,
    );
  }
  return { name: best.name, rel: best.rel.split(sep).join('/') };
}

/**
 * Map an absolute file path onto its root. The result still goes through
 * safePath, which blocks symlink escapes below the root.
 */
function resolveAbsolutePath(
  roots: Record<string, ResolvedRoot>,
  filePath: string,
): ResolvedFile {
  const { name, rel } = matchAbsoluteToRoot(roots, filePath);
  if (!rel) {
    throw new ValidationError(`File path "${filePath}" is a root, not a file.`);
  }
  return {
    rootName: name,
    root: roots[name],
    relativePath: rel,
    prefixedPath: `${name}/${rel}`,
  };
}

/**
 * Rewrite an absolute directory or glob scope to root syntax ("root" or
 * "root/sub/**"); anything else passes through unchanged. Without this an
 * absolute scope reads as a cross-root glob that silently matches nothing.
 */
export function canonicaliseScope(
  roots: Record<string, ResolvedRoot>,
  scope: string | undefined,
): string | undefined {
  if (!scope || !isAbsolute(scope)) return scope;
  const { name, rel } = matchAbsoluteToRoot(roots, scope);
  return rel ? `${name}/${rel}` : name;
}

/**
 * Resolve a scope string to a root name and scope within that root.
 * Returns null rootName if the scope spans all roots (e.g. "**").
 */
export function resolveScope(
  roots: Record<string, ResolvedRoot>,
  rawScope?: string,
): { rootName: string | null; scopeWithinRoot: string | undefined } {
  const scope = canonicaliseScope(roots, rawScope);
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
