// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolContext } from '@nullproof-studio/en-core';
import { safePath } from '@nullproof-studio/en-core';
import { requirePermission } from '@nullproof-studio/en-core';
import { logExecAudit } from '@nullproof-studio/en-core';

const execFileAsync = promisify(execFile);

export const DocExecSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  working_dir: z.string().optional(),
  root: z.string().optional().describe('Root name to use as working directory. If omitted, uses the first configured root.'),
});

/**
 * Tokenise a shell-style command string into [program, ...args].
 * Handles single quotes, double quotes, and escaped characters.
 * Does NOT process shell expansions, redirections, or pipes.
 */
export function tokeniseCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let hasQuoted = false; // Track whether current token contains quoted content

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

export async function handleDocExec(
  args: z.infer<typeof DocExecSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'exec', '**');

  // Resolve working directory: explicit working_dir within a root, or the root itself
  const rootName = args.root ?? Object.keys(ctx.config.document_roots)[0];
  const root = ctx.config.document_roots[rootName];
  if (!root) {
    throw new Error(`Unknown root "${rootName}". Available: ${Object.keys(ctx.config.document_roots).join(', ')}`);
  }
  const workDir = args.working_dir
    ? safePath(root.path, args.working_dir)
    : root.path;

  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  try {
    // Prefer explicit args array; fall back to tokenising command string
    let program: string;
    let programArgs: string[];

    if (args.args) {
      program = args.command;
      programArgs = args.args;
    } else {
      const tokens = tokeniseCommand(args.command);
      program = tokens[0];
      programArgs = tokens.slice(1);
    }

    const result = await execFileAsync(program, programArgs, {
      cwd: workDir,
      timeout: 30000, // 30 second timeout
      maxBuffer: 1024 * 1024, // 1MB
    });

    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err: unknown) {
    const execError = err as { stdout?: string; stderr?: string; code?: number };
    stdout = execError.stdout ?? '';
    stderr = execError.stderr ?? String(err);
    exitCode = execError.code ?? 1;
  }

  // Audit log
  logExecAudit(ctx.db, {
    caller: ctx.caller.id,
    command: args.args ? `${args.command} ${args.args.join(' ')}` : args.command,
    working_dir: args.working_dir,
    stdout,
    stderr,
    exit_code: exitCode,
  });

  return { stdout, stderr, exit_code: exitCode };
}
