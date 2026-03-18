// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ConfigSchema } from './schema.js';
import { ValidationError } from '../shared/errors.js';
import type { ResolvedConfig } from '../shared/types.js';

/**
 * Load and validate configuration from a YAML file.
 * Applies defaults for missing optional fields.
 */
export function loadConfig(configPath: string): ResolvedConfig {
  const absolutePath = resolve(configPath);

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

  return {
    document_root: resolve(validated.document_root),
    transport: validated.transport,
    port: validated.port,
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
      dir: validated.logging.dir ? resolve(validated.logging.dir) : null,
    },
    git: {
      enabled: validated.git.enabled,
      auto_commit: validated.git.auto_commit,
      remote: validated.git.remote,
      pr_hook: validated.git.pr_hook,
    },
    callers: validated.callers,
  };
}
