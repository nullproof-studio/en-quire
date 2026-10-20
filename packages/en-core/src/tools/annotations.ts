// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP tool annotation presets. Clients read these from tools/list to decide
 * which calls need user approval, so every tool declares all four hints.
 *
 * Hints describe the worst case — a write in `mode: "write"`. The same call in
 * propose mode only creates a branch, but a hint can't depend on arguments.
 * Idempotent means repeating the call with the same arguments changes nothing
 * more; a repeat that fails (file already exists, section already gone) counts.
 */

/** Reads only. Index refreshes and logs are not side effects a client gates on. */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Adds content without touching what's there; repeating the call adds it again. */
export const ADDITIVE_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/** Changes a document without losing content (create, rename, move, anchors). */
export const NON_DESTRUCTIVE_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Overwrites or removes content; repeating the call changes nothing more. */
export const OVERWRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

/** Overwrites or removes content; repeating the call may change more. */
export const DESTRUCTIVE_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};
