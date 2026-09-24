// The MCP HTTP listener — its own port on all interfaces (see
// MCP_SERVER_PORT's own comment in shared/constants.ts) and bearer-token
// gated (see mcpServerSettings.ts), on top of
// the low-level @modelcontextprotocol/sdk Server rather than the high-level
// McpServer convenience wrapper — McpServer.registerTool only accepts Zod
// schemas for a tool's inputSchema, which would mean hand-writing a second,
// parallel Zod description of Widget/Plugin alongside shared/types.ts's own
// real ones (exactly the drift risk this feature exists to avoid — see
// tools.ts's own comment). The low-level Server's ListToolsRequestSchema/
// CallToolRequestSchema handlers work with plain JSON Schema at the
// Tool.inputSchema level instead, which is what
// scripts/generate-mcp-schemas.ts already produces directly from
// shared/types.ts.
//
// Session handling follows the SDK's own reference implementation
// (examples/server/simpleStreamableHttp.ts) rather than one singleton
// Server/Transport for the process lifetime — confirmed the hard way in
// manual testing that a single shared Server rejects any session's second
// `initialize` call with "Server already initialized", since the low-level
// Server's own handshake state is per-connection, not something multiple
// concurrent (or successively reconnecting) MCP clients can share. Each new
// session gets its own Server+Transport pair, tracked by the Mcp-Session-Id
// header in `sessions` below; the request body has to be read and
// JSON-parsed here (unlike the SDK's own Express-based example, which gets
// a pre-parsed req.body from body-parser middleware) since this listener is
// a bare node:http server, same as every other secondary HTTP surface in
// this app (restIncoming.ts).
import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Server as McpProtocolServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { ListToolsRequestSchema, CallToolRequestSchema, isInitializeRequest, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { MCP_SERVER_PORT } from '../../shared/constants'
import { getAppSettings } from '../appSettings'
import { getMcpServerSettings } from '../mcpServerSettings'
import { createMcpTools, type McpDeps } from './tools'
import { readBody } from '../httpBody'
import { timingSafeStringEqual } from '../timingSafeAuth'

export type { McpDeps } from './tools'

interface Running {
  httpServer: HttpServer
  sessions: Map<string, StreamableHTTPServerTransport>
  signature: string
}

let running: Running | null = null
let listenStatus: { listening: boolean; listenError?: string } = { listening: false }

export function getMcpListenStatus(): { listening: boolean; listenError?: string } {
  return listenStatus
}

function mcpPluginEnabled(): boolean {
  return getAppSettings().enabledPlugins.includes('mcp')
}

// Only {enabled, bearerToken} matter here — same "no restart needed for
// content edits" reasoning restIncoming.ts's own signatureOf documents; the
// actual tool set is static per app version, nothing about it needs a
// restart to change. A token/enable change tears down every open session
// along with the listener — acceptable since this only happens from an
// explicit Settings action (regenerate/toggle), not something a connected
// client would be surprised by.
function signatureOf(): string {
  return JSON.stringify({ enabled: mcpPluginEnabled(), bearerToken: getMcpServerSettings().bearerToken })
}

function stop(): void {
  if (!running) return
  for (const transport of running.sessions.values()) void transport.close()
  running.httpServer.close()
  running = null
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const data = await readBody(req)
  try {
    return data ? JSON.parse(data) : undefined
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}

function sendJsonRpcError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
}

// Idempotent start/stop/restart, same shape as restIncoming.ts's
// syncRestIncomingServers — call once at startup and again any time
// enabledPlugins or the bearer token changes (see applyAppSettingsPatch and
// the mcp-server:regenerate-token WS case in main/index.ts).
export function syncMcpServer(deps: McpDeps): void {
  const shouldRun = mcpPluginEnabled()
  const signature = signatureOf()

  if (running && (!shouldRun || running.signature !== signature)) stop()
  if (!shouldRun) {
    listenStatus = { listening: false }
    return
  }
  if (running) return

  const { tools, callTool } = createMcpTools(deps)
  const sessions = new Map<string, StreamableHTTPServerTransport>()

  function newSessionTransport(): StreamableHTTPServerTransport {
    const mcpServer = new McpProtocolServer({ name: 'boarderoni', version: '0.1.0' }, { capabilities: { tools: {} } })
    mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
    mcpServer.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
      return callTool(request.params.name, request.params.arguments ?? {})
    })
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, transport)
      }
    })
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId)
    }
    void mcpServer.connect(transport)
    return transport
  }

  const httpServer = createServer((req, res) => {
    const token = getMcpServerSettings().bearerToken
    if (!timingSafeStringEqual(req.headers.authorization ?? '', `Bearer ${token}`)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid or missing bearer token' }))
      return
    }

    readJsonBody(req)
      .then(async (body) => {
        const sessionId = req.headers['mcp-session-id']
        const existing = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined
        const transport = existing ?? (isInitializeRequest(body) ? newSessionTransport() : null)
        if (!transport) {
          sendJsonRpcError(res, 400, 'Bad Request: No valid session ID provided')
          return
        }
        await transport.handleRequest(req, res, body)
      })
      .catch((err: unknown) => {
        console.error('[boarderoni] MCP request failed', err)
        if (!res.headersSent) res.writeHead(500).end()
      })
  })
  httpServer.on('error', (err) => {
    listenStatus = { listening: false, listenError: err instanceof Error ? err.message : String(err) }
  })
  httpServer.listen(MCP_SERVER_PORT, '0.0.0.0', () => {
    listenStatus = { listening: true }
  })

  running = { httpServer, sessions, signature }
}
