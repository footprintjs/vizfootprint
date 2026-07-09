/**
 * vizfootprint/mcp — the OPTIONAL Model Context Protocol surface.
 *
 * Import from here (not `vizfootprint/agent`) to expose a session as a real MCP
 * server. This subpath is the ONLY place `@modelcontextprotocol/sdk` — an
 * OPTIONAL peer dependency (`package.json` `peerDependenciesMeta`) — is
 * imported, so `vizfootprint/agent` stays SDK-free and anyone who does not need
 * MCP never pulls the SDK.
 *
 * ```ts
 * import { vizAsTools } from 'vizfootprint/agent';  // primitive — zero extra deps
 * import { mcpServer }  from 'vizfootprint/mcp';     // full MCP server — needs the SDK peer
 * ```
 */
export { mcpServer } from './mcpServer.js';
export type { McpServerOptions } from './mcpServer.js';
