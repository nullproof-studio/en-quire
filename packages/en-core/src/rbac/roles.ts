// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { CallerScope } from '../shared/types.js';

/**
 * Identity facts derived from an authenticated request. The OAuth verifier
 * (or any future auth backend) reduces a validated token to this shape; the
 * resolver then maps it to a permission scope set via the deployer's RBAC
 * policy.
 *
 * `subject` is the only guaranteed fact — every IdP supplies a verified
 * identity. `groups` / `roles` are present only when the IdP attaches them
 * (corporate directories do; consumer Google does not). `domain` carries a
 * verified hosted-domain signal (e.g. Google Workspace's `hd` claim) — NOT
 * the email suffix, which is a weaker signal.
 */
export interface IdentityFacts {
  subject: string;
  groups?: string[];
  roles?: string[];
  domain?: string;
}

/**
 * A single role binding: one selector → one or more roles. Exactly one
 * selector field is expected to be set (enforced by config validation); the
 * resolver matches whichever selector is present against the identity facts.
 */
export interface RoleBinding {
  user?: string;
  domain?: string;
  idp_group?: string;
  idp_role?: string;
  local_group?: string;
  roles: string[];
}

/**
 * Resolved RBAC policy (post-validation): named roles, deployer-maintained
 * local groups (membership for IdPs that supply none), bindings, and an
 * optional default role applied when nothing else matches.
 */
export interface RbacConfig {
  roles: Record<string, CallerScope[]>;
  local_groups: Record<string, string[]>;
  bindings: RoleBinding[];
  default_role: string | null;
}

export interface ResolvedAccess {
  /** Matched role names, in first-seen order, deduped. */
  roles: string[];
  /** Flattened scopes from the matched roles, ready for `checkPermission`. */
  scopes: CallerScope[];
}

const lc = (s: string) => s.toLowerCase();

/**
 * Whether an identity satisfies a single binding's selector.
 *
 * Email-like comparisons (`user`, `local_group` membership, `domain`) are
 * case-insensitive — email addresses and DNS domains are treated
 * case-insensitively in practice, and IdPs normalise them inconsistently.
 * IdP-supplied `groups` / `roles` claim values are matched exactly, since
 * those are opaque directory identifiers, not addresses.
 */
function bindingMatches(
  binding: RoleBinding,
  facts: IdentityFacts,
  localGroups: Record<string, string[]>,
): boolean {
  if (binding.user !== undefined) {
    return lc(binding.user) === lc(facts.subject);
  }
  if (binding.domain !== undefined) {
    return facts.domain !== undefined && lc(binding.domain) === lc(facts.domain);
  }
  if (binding.idp_group !== undefined) {
    return facts.groups?.includes(binding.idp_group) ?? false;
  }
  if (binding.idp_role !== undefined) {
    return facts.roles?.includes(binding.idp_role) ?? false;
  }
  if (binding.local_group !== undefined) {
    const members = localGroups[binding.local_group] ?? [];
    return members.some((m) => lc(m) === lc(facts.subject));
  }
  // A binding with no selector matches nothing — validation rejects these,
  // but resolve-time we fail closed rather than matching everyone.
  return false;
}

/**
 * Resolve an authenticated identity to a permission scope set via the RBAC
 * policy. Pure and side-effect free.
 *
 * Algorithm:
 *  1. Collect roles from every binding whose selector the identity satisfies
 *     (union, first-seen order preserved).
 *  2. If no binding matched and a `default_role` is configured, use it.
 *  3. Expand the matched roles to their scopes (union, deduped). Roles that
 *     are matched but undefined contribute no scopes (config validation
 *     normally prevents this; the resolver tolerates it fail-closed).
 *
 * An empty `scopes` result means "authenticated but no grants" — the caller
 * is known but authorised for nothing (a 403, distinct from an auth failure).
 */
export function resolveScopes(facts: IdentityFacts, rbac: RbacConfig): ResolvedAccess {
  const matchedRoles: string[] = [];
  for (const binding of rbac.bindings) {
    if (!bindingMatches(binding, facts, rbac.local_groups)) continue;
    for (const role of binding.roles) {
      if (!matchedRoles.includes(role)) matchedRoles.push(role);
    }
  }

  if (matchedRoles.length === 0 && rbac.default_role) {
    matchedRoles.push(rbac.default_role);
  }

  const scopes: CallerScope[] = [];
  const seen = new Set<string>();
  for (const role of matchedRoles) {
    const roleScopes = rbac.roles[role];
    if (!roleScopes) continue; // unknown role → no scopes
    for (const scope of roleScopes) {
      const key = JSON.stringify(scope);
      if (seen.has(key)) continue;
      seen.add(key);
      scopes.push(scope);
    }
  }

  return { roles: matchedRoles, scopes };
}
