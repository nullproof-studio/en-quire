// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ResolvedConfig } from '../shared/types.js';

export const DEFAULT_CONFIG: Omit<ResolvedConfig, 'document_roots' | 'database'> = {
  transport: 'stdio',
  port: 3100,
  listen_host: '127.0.0.1',
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
  callers: {},
  require_read_before_write: true,
};
