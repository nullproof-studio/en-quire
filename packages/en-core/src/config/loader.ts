// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ConfigSchema } from './schema.js';
import { ValidationError } from '../shared/errors.js';
import type { ResolvedConfig, ResolvedRoot } from '../shared/types.js';

/**
 * Load and validate configuration from a YAML file.
 * Applies defaults for missing optional fields.
 */
export function loadConfig(configPath: string): ResolvedConfig {
  const absolutePath = resolve(configPath);
  const configDir = dirname(absolutePath);

  let raw: string;
  try {
    raw = readFileSync(absolutePath, 'utf-8');
  } catch (err) {
    throw new ValidationError(
      `Cannot read config file: ${absolutePath}`,
      err,
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new ValidationError(
      `Invalid YAML in config file: ${absolutePath}`,
      err,
    );
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError(
      `Invalid configuration: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      result.error.issues,
    );
  }

  const validated = result.data;

  // HTTP transport requires every caller to have a Bearer `key` — the
  // auto-select fallback in resolver.ts is stdio-only, so an HTTP request
  // without a recognisable token is indistinguishable from any other. Fail
  // loudly at startup rather than at the first 401.
  if (validated.transport === 'streamable-http') {
    const missing = Object.entries(validated.callers)
      .filter(([, caller]) => !caller.key)
      .map(([id]) => id);
    if (missing.length > 0) {
      throw new ValidationError(
        `HTTP transport requires every caller to have a Bearer 'key'. ` +
        `Missing keys for caller(s): ${missing.join(', ')}.`,
      );
    }

    // Minimum key strength — reject obvious test/placeholder values that
    // would otherwise pass the "non-empty string" check. 32 chars isn't a
    // cryptographic guarantee, but it rules out "x", "secret", "changeme"
    // and the like, which is the class of misconfiguration this catches.
    const MIN_KEY_LENGTH = 32;
    const tooShort = Object.entries(validated.callers)
      .filter(([, caller]) => caller.key && caller.key.length < MIN_KEY_LENGTH)
      .map(([id, caller]) => `${id} (${caller.key?.length ?? 0} chars)`);
    if (tooShort.length > 0) {
      throw new ValidationError(
        `HTTP transport requires caller keys to be at least ${MIN_KEY_LENGTH} characters. ` +
        `Weak keys: ${tooShort.join(', ')}. Use crypto.randomBytes(24).toString('base64') ` +
        `or similar to generate tokens.`,
      );
    }

    // Reject obvious placeholder values even if they meet the length bar —
    // padding "changeme" to 32 chars is a user error, not a legitimate key.
    const placeholderPatterns = [
      /^change[_-]?me/i,
      /^placeholder/i,
      /^test[_-]?token/i,
      /^secret$/i,
      /^token$/i,
      /^(.)\1+$/, // all the same character
    ];
    const placeholder = Object.entries(validated.callers)
      .filter(([, caller]) => caller.key && placeholderPatterns.some((p) => p.test(caller.key!)))
      .map(([id]) => id);
    if (placeholder.length > 0) {
      throw new ValidationError(
        `HTTP transport: caller key(s) look like placeholder values: ${placeholder.join(', ')}. ` +
        `Generate real tokens before enabling HTTP transport.`,
      );
    }
  }

  // Resolve document roots
  const document_roots: Record<string, ResolvedRoot> = {};
  for (const [name, root] of Object.entries(validated.document_roots)) {
    document_roots[name] = {
      name,
      path: resolve(configDir, root.path),
      description: root.description,
      git: {
        enabled: root.git.enabled,
        auto_commit: root.git.auto_commit,
        remote: root.git.remote,
        pr_hook: root.git.pr_hook,
      },
    };
  }

  // Resolve database path (defaults to .enquire.db next to config file)
  const database = validated.database
    ? resolve(configDir, validated.database)
    : join(configDir, '.enquire.db');

  return {
    document_roots,
    database,
    transport: validated.transport,
    port: validated.port,
    listen_host: validated.listen_host,
    search: {
      fulltext: validated.search.fulltext,
      sync_on_start: validated.search.sync_on_start,
      batch_size: validated.search.batch_size,
      semantic: {
        enabled: validated.search.semantic.enabled,
        endpoint: validated.search.semantic.endpoint,
        model: validated.search.semantic.model,
        dimensions: validated.search.semantic.dimensions,
      },
    },
    logging: {
      level: validated.logging.level,
      dir: validated.logging.dir ? resolve(configDir, validated.logging.dir) : null,
    },
    callers: validated.callers,
    require_read_before_write: validated.require_read_before_write,
  };
}
