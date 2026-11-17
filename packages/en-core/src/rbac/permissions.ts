// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import picomatch from 'picomatch';
import type { CallerIdentity, Permission } from '../shared/types.js';
import { PermissionDeniedError } from '../shared/errors.js';

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if a caller has a specific permission for a given file path.
 */
export function checkPermission(
  caller: CallerIdentity,
  permission: Permission,
  filePath: string,
): PermissionCheckResult {
  for (const scope of caller.scopes) {
    if (picomatch.isMatch(filePath, scope.path)) {
      if (scope.permissions.includes(permission)) {
        return { allowed: true };
      }
    }
  }

  return {
    allowed: false,
    reason: `Caller "${caller.id}" does not have "${permission}" permission for path "${filePath}".`,
  };
}

/**
 * Keep only the items whose path the caller holds `permission` on.
 *
 * Tools that return many files (list, search, status, proposals) must run
 * every result through this — checking the `scope` argument alone is not
 * enough, because a scope string can satisfy a pattern such as `docs/*`
 * while the results it selects extend beneath it.
 */
export function filterPermitted<T>(
  caller: CallerIdentity,
  permission: Permission,
  items: readonly T[],
  pathOf: (item: T) => string,
): T[] {
  return items.filter((item) => checkPermission(caller, permission, pathOf(item)).allowed);
}

/**
 * Build a per-path predicate for `permission`, for APIs that take a filter
 * function (e.g. `searchDocuments`'s `file_filter`).
 */
export function permittedPathFilter(
  caller: CallerIdentity,
  permission: Permission,
): (path: string) => boolean {
  return (path) => checkPermission(caller, permission, path).allowed;
}

/**
 * Assert a caller has a permission, throwing if denied.
 */
export function requirePermission(
  caller: CallerIdentity,
  permission: Permission,
  filePath: string,
): void {
  const result = checkPermission(caller, permission, filePath);
  if (!result.allowed) {
    throw new PermissionDeniedError(caller.id, permission, filePath);
  }
}

/**
 * Resolve the write mode for a caller.
 * Returns the effective mode based on caller permissions and explicit request.
 */
export function resolveWriteMode(
  caller: CallerIdentity,
  filePath: string,
  requestedMode?: 'write' | 'propose',
): 'write' | 'propose' {
  const canWrite = checkPermission(caller, 'write', filePath).allowed;
  const canPropose = checkPermission(caller, 'propose', filePath).allowed;

  if (!canWrite && !canPropose) {
    throw new PermissionDeniedError(caller.id, 'write or propose', filePath);
  }

  if (requestedMode === 'write') {
    if (!canWrite) {
      throw new PermissionDeniedError(caller.id, 'write', filePath);
    }
    return 'write';
  }

  if (requestedMode === 'propose') {
    if (!canPropose) {
      throw new PermissionDeniedError(caller.id, 'propose', filePath);
    }
    return 'propose';
  }

  // Default: prefer write if available, otherwise propose
  return canWrite ? 'write' : 'propose';
}
