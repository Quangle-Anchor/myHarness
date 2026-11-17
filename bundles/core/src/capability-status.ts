/**
 * Registers a read-only tool that reports which tools the calling agent can
 * use and whether each expected context provider currently contributes tools.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { summarizeContextProviders } from './context-providers.ts'

export const name = 'map-capability-status'
export const inject = ['tools']

export interface Config {
  /** Model-facing tool name. */
  toolName: string
  /** MCP server names the deployment expects, reported as `unavailable` while they contribute no tool. */
  expectedContextProviders: string[]
}

export const Config: Schema<Config> = Schema.object({
  toolName: Schema.string().default('capability_status'),
  expectedContextProviders: Schema.array(Schema.string()).default([]),
})

export function apply(ctx: Context, config: Config) {
  ctx.tools.register(defineTool({
    name: config.toolName,
    description: 'Report the tools you can call right now and whether each optional context provider (such as document retrieval) is available. Call it before relying on a context provider, or when asked what you can do.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tools: { type: 'array', required: true, items: { type: 'string' } },
          contextProviders: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: ['available', 'unavailable'] },
                tools: { type: 'array', required: true, items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const providers = value.contextProviders.length === 0
          ? 'No context provider is configured.'
          : value.contextProviders
              .map(provider => provider.status === 'available'
                ? `Context provider "${provider.name}" is available: ${provider.tools.join(', ')}.`
                : `Context provider "${provider.name}" is unavailable: it contributes no tool, so do not claim to have retrieved anything from it.`)
              .join('\n')
        return [{ type: 'text', text: `Tools (${value.tools.length}): ${value.tools.join(', ')}\n${providers}` }]
      },
    },
    execute(_args, exec) {
      const toolNames = ctx.tools.schemas(exec.agent, exec.toolSet).map(schema => schema.name).sort()
      return { tools: toolNames, contextProviders: summarizeContextProviders(toolNames, config.expectedContextProviders) }
    },
  }))
}
