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
