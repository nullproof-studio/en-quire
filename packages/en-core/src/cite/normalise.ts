// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE

const SMART_QUOTE_FOLD: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
};

const DASH_FOLD: Record<string, string> = {
  '–': '-',
  '—': '-',
  '―': '-',
  '−': '-',
};

const STRIP_CHARS = /[​-‏‪-‮⁦-⁩﻿]/g;
const FOLD_CHARS = /[‘’‚‛“”„‟–—―−]/g;
const WHITESPACE_RUN = /[ \t\f\v\r\n ]+/g;

/**
 * Normalise text for the no-exact-match fallback comparison. Used inside the
 * cite verifier only — never escapes the cite layer. Both the fetched source
 * text and the agent's quote are passed through this before a second-pass
 * literal compare. A successful match here returns a `formatting_difference`
 * warning rather than a clean `verified`.
 */
export function normaliseForFallback(text: string): string {
  if (text.length === 0) return text;

  const stripped = text.normalize('NFKC').replace(STRIP_CHARS, '');
  const folded = stripped.replace(FOLD_CHARS, (ch) => SMART_QUOTE_FOLD[ch] ?? DASH_FOLD[ch] ?? ch);
  return folded.replace(WHITESPACE_RUN, ' ');
}
