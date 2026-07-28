// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';

/**
 * Drop-in replacement for z.boolean() that also accepts the string forms
 * ("true"/"false"/"1"/"0", case-insensitive) some MCP clients send instead
 * of a native JSON boolean. Anything else falls through to z.boolean()'s
 * normal type-mismatch error. Chain .default()/.optional()/.describe() as
 * usual — this is a straight substitute for z.boolean().
 */
export function booleanish() {
  return z.preprocess((value) => {
    if (typeof value === 'string') {
      const normalised = value.trim().toLowerCase();
      if (normalised === 'true' || normalised === '1') return true;
      if (normalised === 'false' || normalised === '0') return false;
    }
    return value;
  }, z.boolean());
}

/**
 * z.enum() with an error message that lists the valid values and appends a
 * caller-supplied hint — used for fields where an agent might send a value
 * that reflects intent rather than a valid option (e.g. "replace" for a
 * position field). Only the invalid-enum-value case is customised; other
 * issue codes (e.g. wrong type) keep zod's default message.
 */
export function enumWithHint<const T extends [string, ...string[]]>(values: T, hint: string) {
  return z.enum(values, {
    errorMap: (issue, ctx) => issue.code === 'invalid_enum_value'
      ? { message: `Invalid value "${ctx.data}". Valid values: ${values.join(', ')}. ${hint}` }
      : { message: ctx.defaultError },
  });
}
