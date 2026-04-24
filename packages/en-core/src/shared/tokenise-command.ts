// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE

/**
 * Tokenise a shell-style command string into [program, ...args].
 * Handles single quotes, double quotes, and escaped characters.
 * Does NOT process shell expansions, redirections, or pipes — callers
 * are expected to pass the result to `execFile`, which bypasses shell
 * interpretation entirely.
 */
export function tokeniseCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let hasQuoted = false;

  for (const ch of command) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\' && !inSingle) {
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      hasQuoted = true;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      hasQuoted = true;
      continue;
    }

    if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (current.length > 0 || hasQuoted) {
        tokens.push(current);
        current = '';
        hasQuoted = false;
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0 || hasQuoted) {
    tokens.push(current);
  }

  return tokens;
}
