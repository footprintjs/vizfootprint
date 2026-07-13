/**
 * mcpServer(session) — expose an {@link InteractionSession} as a real MODEL
 * CONTEXT PROTOCOL server, so any MCP host (Claude Desktop, a LangGraph MCP
 * client, Cursor, …) can drive the dashboard with no framework-specific glue.
 *
 * It wraps {@link vizAsTools} (Mode B): `tools/list` returns the FIXED tool
 * array (whats_here / dispatch / declare_analysis / why / fork / checkpoint /
 * paths / compare) and `tools/call` routes to the port. Because the tool set
 * never changes, a plain MCP server works with no `tools/list_changed` churn —
 * the whole point of the fixed-tool design.
 *
 * This module lives behind the `vizfootprint/mcp` subpath and is the ONLY place
 * `@modelcontextprotocol/sdk` (an OPTIONAL peer dependency) is imported — the
 * core `vizfootprint/agent` entry stays SDK-free, mirroring hcifootprint
 * (`hcifootprint/src/serve/mcp-server.ts`). You pick the transport (stdio, SSE,
 * streamable HTTP) and connect it yourself.
 *
 * @example
 *   import { mcpServer } from 'vizfootprint/mcp';
 *   import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
 *   const server = mcpServer(session);
 *   await server.connect(new StdioServerTransport());
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { vizAsTools, type VizToolsOptions } from '../agent/vizAsTools.js';
import type { InteractionSession } from '../session/index.js';

export interface McpServerOptions extends VizToolsOptions {
  /** Server name advertised over MCP. Default 'vizfootprint'. */
  name?: string;
  /** Server version advertised over MCP. Default '0.1.0'. */
  version?: string;
}

/**
 * Build an MCP `Server` backed by a live session. Attach any transport with
 * `server.connect(transport)`. The tool surface is IDENTICAL to
 * `vizAsTools(session)` (family dual-surface parity).
 */
export function mcpServer(session: InteractionSession, opts?: McpServerOptions): Server {
  const port = vizAsTools(session, opts);
  const server = new Server(
    { name: opts?.name ?? 'vizfootprint', version: opts?.version ?? '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // Fixed tool list — identical bytes every request (Mode B), so no list_changed.
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: port.tools() as unknown as Tool[],
  }));

  // Route a call to the port. A domain rejection (a typed gap, a not-implemented
  // why) is a NORMAL result the model reads; only a genuinely unknown tool or an
  // unexpected throw is surfaced as isError.
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await port.call(name, args ?? {});
      const misused = result['reason'] === 'UNKNOWN_TOOL';
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        ...(misused ? { isError: true } : {}),
      };
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `vizfootprint: tool '${name}' failed: ${String(error)}` }],
        isError: true,
      };
    }
  });

  return server;
}
