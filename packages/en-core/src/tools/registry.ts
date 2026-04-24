// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ZodRawShape } from 'zod';
import type { ToolContext } from './context.js';

/**
 * Declarative description of an MCP tool: name, description, argument schema,
 * and handler. The registry holds these; transport attachment (server.tool call)
 * happens later, so the same registry can be bound to any MCP server instance.
 */
export interface ToolDefinition<Args = any> {
  name: string;
  description: string;
  schema: ZodRawShape;
  handler: (args: Args, ctx: ToolContext) => Promise<unknown>;
}

/**
 * Collects tool definitions from one or more plugins (en-quire, en-scribe, future packs).
 * Rejects duplicate names at registration time — clients see a single flat namespace.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(
        `Duplicate tool registration: "${tool.name}" is already registered.`,
      );
    }
    this.tools.set(tool.name, tool);
  }

  all(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}
