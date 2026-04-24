// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE

// Matches fenced code blocks: ```...``` and ~~~...~~~ across multiple lines.
// Non-greedy to handle multiple fences in a document.
const FENCED_CODE_RE = /^([`~]{3,})[^\n]*\n[\s\S]*?^\1[`~]*\s*$/gm;

const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'word' });

/**
 * Count words in prose content.
 *
 * Definition of a word:
 *   - Fenced code blocks (``` and ~~~) are stripped before counting — code
 *     should not inflate prose word totals for drafting tools.
 *   - Uses Intl.Segmenter with word granularity, so both whitespace-separated
 *     scripts (English, most European languages) and non-whitespace scripts
 *     (CJK) produce meaningful counts.
 *   - Punctuation, backticks, asterisks, and other Markdown syntax are not
 *     counted as words.
 *
 * Expect counts to differ from `wc -w` and Microsoft Word by ~1% on English
 * prose. `wc -w` is pure whitespace-splitting (treats "well-known" as one
 * token); Word is similar. Intl.Segmenter follows Unicode UAX #29, which
 * splits hyphenated compounds into constituent word-like segments
 * ("well-known" → "well" + "known"). The cost of exact `wc`/Word parity
 * would be a custom hyphen-handling rules engine; the benefit of the
 * Segmenter approach is that CJK content (where whitespace split returns
 * ~0) produces meaningful counts. Trade accepted.
 */
export function countWords(content: string): number {
  if (!content) return 0;

  const stripped = content.replace(FENCED_CODE_RE, '');
  if (!stripped.trim()) return 0;

  let count = 0;
  for (const segment of WORD_SEGMENTER.segment(stripped)) {
    if (segment.isWordLike) count++;
  }
  return count;
}
