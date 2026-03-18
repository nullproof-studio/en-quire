// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ResolvedConfig } from '../shared/types.js';

export const DEFAULT_CONFIG: Omit<ResolvedConfig, 'document_root'> = {
  transport: 'stdio',
  port: 3100,
  search: {
    fulltext: true,
    sync_on_start: 'blocking',
    batch_size: 500,
    semantic: {
      enabled: false,
    },
  },
  logging: {
    level: 'info',
    dir: null,
  },
  git: {
    enabled: null, // auto-detect
    auto_commit: true,
    remote: null,
    pr_hook: null,
  },
  callers: {},
};
