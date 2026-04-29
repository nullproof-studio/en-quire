// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE

// Shared primitives
export * from './shared/diff.js';
export * from './shared/encoding.js';
export * from './shared/errors.js';
export * from './shared/etag.js';
export * from './shared/file-utils.js';
export * from './shared/levenshtein.js';
export * from './shared/logger.js';
export * from './shared/tokenise-command.js';
export * from './shared/types.js';
export * from './shared/word-count.js';

// Config
export * from './config/defaults.js';
export * from './config/loader.js';
export * from './config/roots.js';
export * from './config/schema.js';

// RBAC
export * from './rbac/http-auth.js';
export * from './rbac/permissions.js';
export * from './rbac/resolver.js';
export * from './rbac/types.js';

// Git
export * from './git/commit-message.js';
export * from './git/detector.js';
export * from './git/operations.js';
export * from './git/post-propose.js';

// Search
export * from './search/database.js';
export * from './search/indexer.js';
export * from './search/link-storage.js';
export * from './search/query.js';
export * from './search/schema.js';
export * from './search/sync.js';

// Document — format-agnostic pieces
export * from './document/ast-utils.js';
export * from './document/line-utils.js';
export * from './document/ops-strategy.js';
export * from './document/parser-registry.js';
export * from './document/section-address.js';
export * from './document/section-ops-core.js';
export * from './document/section-tree.js';
export * from './document/text-find.js';

// Tool runtime
export * from './tools/audit-log.js';
export * from './tools/context.js';
export * from './tools/proposals.js';
export * from './tools/registry.js';
export * from './tools/runtime.js';
export * from './tools/status.js';
export * from './tools/write-helpers.js';
