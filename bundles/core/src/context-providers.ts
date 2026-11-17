/** Pure derivation of context-provider availability from visible tool names. */

/** One MCP server's visible tools, or its absence. */
export interface ContextProviderStatus {
  name: string
  status: 'available' | 'unavailable'
  tools: string[]
}

const MCP_TOOL_NAME = /^mcp__([A-Za-z0-9_-]+?)__(.+)$/

/**
 * Group visible MCP tool names by server and add each expected server that has none.
 * @param toolNames - tool names visible to one agent.
 * @param expected - server names the deployment expects.
 * @returns one entry per server, expected servers first, in a stable order.
 */
export function summarizeContextProviders(toolNames: readonly string[], expected: readonly string[]): ContextProviderStatus[] {
  const byServer = new Map<string, string[]>()
  for (const server of expected) byServer.set(server, [])
  for (const toolName of toolNames) {
    const match = MCP_TOOL_NAME.exec(toolName)
    if (match === null) continue
    const tools = byServer.get(match[1]!) ?? []
    tools.push(toolName)
    byServer.set(match[1]!, tools)
  }
  return [...byServer].map(([server, tools]) => ({
    name: server,
    status: tools.length > 0 ? 'available' as const : 'unavailable' as const,
    tools: [...tools].sort(),
  }))
}
