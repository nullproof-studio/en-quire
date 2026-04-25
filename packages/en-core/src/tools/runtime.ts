// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { EnquireError } from '../shared/errors.js';
import { getLogger } from '../shared/logger.js';
import type { ToolContext } from './context.js';
import type { ToolDefinition, ToolRegistry } from './registry.js';

/**
 * Wrap a handler with diagnostic logging and EnquireError → tool-result conversion.
 * Extracted from server.ts so the same wrapping works for en-quire, en-scribe,
 * and any future tool package.
 */
export function wrapHandler<T>(
  tool: string,
  ctx: ToolContext,
  handler: (args: T, ctx: ToolContext) => Promise<unknown>,
) {
  const logger = getLogger();
  return async (args: T) => {
    const start = performance.now();
    const argsSummary = extractArgsSummary(args);
    logger.info('tool:start', { tool, ...argsSummary });
    try {
      const result = await handler(args, ctx);
      const durationMs = Math.round(performance.now() - start);
      logger.info('tool:complete', { tool, durationMs });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      const durationMs = Math.round(performance.now() - start);
      const error = err instanceof EnquireError
        ? (() => {
            const errExtras = err as unknown as { current_etag?: string; candidates?: unknown };
            return {
              error: err.code,
              message: err.message,
              ...(typeof errExtras.current_etag === 'string' && { current_etag: errExtras.current_etag }),
              ...(Array.isArray(errExtras.candidates) && errExtras.candidates.length > 0
                && { candidates: errExtras.candidates as string[] }),
            };
          })()
        : { error: 'internal_error', message: String(err) };
      logger.error('tool:error', { tool, error: error.error, message: error.message, durationMs });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(error, null, 2) }],
        isError: true,
      };
    }
  };
}

/** Extract loggable fields from tool args (file, section, scope, query) — avoids logging content blobs. */
export function extractArgsSummary(args: unknown): Record<string, string> {
  if (!args || typeof args !== 'object') return {};
  const summary: Record<string, string> = {};
  const a = args as Record<string, unknown>;
  if (typeof a.file === 'string') summary.file = a.file;
  if (typeof a.section === 'string') summary.section = a.section;
  if (typeof a.scope === 'string') summary.scope = a.scope;
  if (typeof a.query === 'string') summary.query = a.query;
  return summary;
}

/**
 * Bind every tool in the registry to the MCP server, wrapping each handler
 * with logging and error conversion.
 */
export function attachRegistry(
  server: McpServer,
  registry: ToolRegistry,
  ctx: ToolContext,
): void {
  for (const tool of registry.all()) {
    server.tool(
      tool.name,
      tool.description,
      tool.schema,
      wrapHandler(tool.name, ctx, tool.handler as ToolDefinition['handler']),
    );
  }
}
