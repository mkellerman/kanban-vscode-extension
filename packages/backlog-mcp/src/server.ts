/**
 * Backlog MCP server.
 *
 * Exposes the contract tools over stdio, backed by the registry-driven library.
 * Board root comes from PA_BOARD_ROOT (or cwd). The native adapter reads real
 * per-story folders; sessions are fixture-backed until the sessions-domain slice.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as lib from './index'
import { ListWorkItemsInput, IdInput, ListSessionsInput, TOOL_DESCRIPTIONS } from './contract'

const server = new McpServer({ name: 'backlog-mcp', version: '0.0.0' })

const asText = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }]
})

server.registerTool(
  'detect_frameworks',
  { description: TOOL_DESCRIPTIONS.detect_frameworks, inputSchema: {} },
  async () => asText(await lib.detectFrameworks())
)
server.registerTool(
  'list_work_items',
  { description: TOOL_DESCRIPTIONS.list_work_items, inputSchema: ListWorkItemsInput },
  async (args) => asText(await lib.listWorkItems(args))
)
server.registerTool(
  'get_work_item',
  { description: TOOL_DESCRIPTIONS.get_work_item, inputSchema: IdInput },
  async ({ id }) => asText((await lib.getWorkItem(id)) ?? null)
)
server.registerTool(
  'get_item_body',
  { description: TOOL_DESCRIPTIONS.get_item_body, inputSchema: IdInput },
  async ({ id }) => ({ content: [{ type: 'text' as const, text: await lib.getItemBody(id) }] })
)
server.registerTool(
  'dependency_graph',
  { description: TOOL_DESCRIPTIONS.dependency_graph, inputSchema: {} },
  async () => asText(await lib.dependencyGraph())
)
server.registerTool(
  'list_sessions',
  { description: TOOL_DESCRIPTIONS.list_sessions, inputSchema: ListSessionsInput },
  async (args) => asText(lib.listSessions(args))
)
server.registerTool(
  'get_session',
  { description: TOOL_DESCRIPTIONS.get_session, inputSchema: IdInput },
  async ({ id }) => asText(lib.getSession(id) ?? null)
)

await server.connect(new StdioServerTransport())
console.error('[backlog-mcp] server running on stdio (board root:', process.env.PA_BOARD_ROOT ?? process.cwd(), ')')
