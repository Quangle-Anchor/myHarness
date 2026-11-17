/**
 * Policy for the optional retrieval service reached through MCP.
 *
 * - Operator-only tools of the service are denied by an execution guard, which no
 *   other listener can turn back into permission, and are removed from each agent's
 *   tool list when the service has registered them.
 * - Results of the retrieval tool are bounded and replaced by text that labels the
 *   passages as untrusted data.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { renderRetrievedContext } from './evidence.ts'

export const name = 'map-rag-policy'
export const inject = ['tools']

export interface Config {
  /** The `serverName` of the MCP client row that connects the retrieval service. */
  serverName: string
  /** The service's read-only retrieval tool, by its raw MCP name. */
  retrieveTool: string
  /** Raw MCP names of service tools the agent must neither see nor call. */
  deniedTools: string[]
  /** Maximum passages kept from one retrieval result. */
  maxEvidence: number
  /** Maximum characters kept per passage. */
  maxEvidenceChars: number
  /** Maximum characters kept across all passages of one result. */
  maxTotalChars: number
}

export const Config: Schema<Config> = Schema.object({
  serverName: Schema.string().required(),
  retrieveTool: Schema.string().required(),
  deniedTools: Schema.array(Schema.string()).default([]),
  maxEvidence: Schema.number().min(1).default(5),
  maxEvidenceChars: Schema.number().min(1).default(1500),
  maxTotalChars: Schema.number().min(1).default(6000),
})

/** Stable code recorded on a denied operator-only call. */
export const OPERATOR_ONLY_TOOL = 'MAP_OPERATOR_ONLY_TOOL'

export function apply(ctx: Context, config: Config) {
  const publicName = (rawName: string): string => `mcp__${config.serverName}__${rawName}`
  const denied = new Set(config.deniedTools.map(publicName))
  const retrieveName = publicName(config.retrieveTool)
  if (denied.has(retrieveName)) {
    throw new Error(`map-rag-policy: "${config.retrieveTool}" is both the retrieval tool and a denied tool`)
  }

  // Enforcement: evaluated after every pre-execute listener, for every caller.
  ctx.tools.guard((exec) => {
    if (!denied.has(exec.name)) return undefined
    return {
      reason: `"${exec.name}" is an operator-only maintenance tool and is not available to the agent. Do not retry it; continue without it.`,
      info: { name: 'OperatorOnlyToolError', code: OPERATOR_ONLY_TOOL },
    }
  })

  // Visibility: a restriction can only name a registered tool, and the service may
  // connect after an agent exists, so each agent is checked again before every step.
  const hidden = new WeakMap<Agent, Set<string>>()
  const hide = (agent: Agent): void => {
    const already = hidden.get(agent) ?? new Set<string>()
    const visible = new Set(ctx.tools.schemas(agent).map(schema => schema.name))
    const pending = [...denied].filter(toolName => visible.has(toolName) && !already.has(toolName))
    if (pending.length === 0) return
    agent.ctx.tools.restrict({ deny: pending })
    for (const toolName of pending) already.add(toolName)
    hidden.set(agent, already)
  }
  ctx.on('agent/created', ({ agent }) => {
    hide(agent)
    return undefined
  })
  ctx.on('agent/pre-step', async (payload, next) => {
    hide(payload.agent)
    return next()
  })

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    if (exec.name !== retrieveName || result.isError || decision.kind !== 'accept' || decision.value !== undefined) return decision
    const content = decision.content ?? result.content
    const raw = content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    const text = renderRetrievedContext(raw, {
      maxEvidence: config.maxEvidence,
      maxEvidenceChars: config.maxEvidenceChars,
      maxTotalChars: config.maxTotalChars,
    }, config.serverName)
    return { ...decision, content: [{ type: 'text', text }] }
  })
}
