// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE

/**
 * Compute the Levenshtein edit distance between two strings.
 * Two-row dynamic programming — O(m*n) time, O(min(m,n)) space.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Rank candidates by Levenshtein distance to `query` and return the closest
 * `limit` matches. Comparison is case-insensitive; ties break lexically on the
 * original (case-preserving) candidate string for deterministic output.
 */
export function rankByLevenshtein(
  query: string,
  candidates: string[],
  limit: number,
): string[] {
  if (candidates.length === 0 || limit <= 0) return [];
  const lq = query.toLowerCase();
  return candidates
    .map((c) => ({ c, d: levenshtein(lq, c.toLowerCase()) }))
    .sort((a, b) => a.d - b.d || a.c.localeCompare(b.c))
    .slice(0, limit)
    .map((x) => x.c);
}
