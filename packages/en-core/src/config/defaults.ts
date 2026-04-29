// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ResolvedConfig } from '../shared/types.js';

export const DEFAULT_CONFIG: Omit<ResolvedConfig, 'document_roots' | 'database'> = {
  transport: 'stdio',
  port: 3100,
  listen_host: '127.0.0.1',
  search: {
    sync_on_start: 'blocking',
    batch_size: 500,
    semantic: {
      enabled: false,
      api_key: null,
      api_key_env: null,
    },
  },
  logging: {
    level: 'info',
    dir: null,
  },
  callers: {},
  require_read_before_write: true,
  citation: {
    enabled: false,
    section_heading: 'Citations',
    section_position: 'end',
    web_appends_propose: false,
    fetch: {
      https_only: true,
      http_allowlist: [],
      block_private_ranges: true,
      allowed_content_types: [
        'text/html',
        'text/plain',
        'text/markdown',
        'application/json',
        'application/xhtml+xml',
      ],
      timeout_ms: 10_000,
      max_bytes: 5_000_000,
      max_redirects: 3,
      decompression_factor: 5,
      strip_query: true,
      strip_fragment: true,
      allow_userinfo: false,
      max_path_chars: 2048,
      max_host_chars: 253,
      secret_pattern_reject: true,
    },
    rate_limit: {
      external_per_minute: 30,
    },
  },
};
