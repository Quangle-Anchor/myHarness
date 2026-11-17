/** Derives per-run facts from a durable session event log. */
import type { SessionEvent } from '../../tests/harness.ts'
import type { ToolCallSummary, TraceSummary } from './types.ts'

const RETRIEVED_SOURCE = /^\[\d+\] source="([^"]+)"/gm

/**
 * Summarize one session log.
 * @param events - durable events without the header line.
 * @param retrieveTool - model-facing name of the retrieval tool.
 * @returns counts, tool outcomes, retrieved sources, token usage, and the final turn reason.
 */
export function summarizeTrace(events: readonly SessionEvent[], retrieveTool: string): TraceSummary {
  const calls = new Map<string, { name: string, time: number }>()
  const toolCalls: ToolCallSummary[] = []
  const retrievedSources = new Set<string>()
  let inputTokens = 0
  let outputTokens = 0
  let model: string | undefined
  let turnEnd = 'missing'
  let permissionPreset: string | undefined
  let turnErrorCode: string | undefined
  for (const event of events) {
    switch (event.type) {
      case 'tool/call':
        calls.set(event.data.callId, { name: event.data.name, time: event.time })
        break
      case 'tool/result': {
        const call = calls.get(event.data.message.toolCallId)
        if (call === undefined) break
        const summary: ToolCallSummary = { name: call.name, isError: event.data.message.isError === true, durationMs: event.time - call.time }
        if (typeof event.data.error?.code === 'string') summary.errorCode = event.data.error.code
        toolCalls.push(summary)
        if (call.name === retrieveTool && !summary.isError) {
          const text = (event.data.message.content ?? []).map((block: any) => block.text ?? '').join('\n')
          for (const match of text.matchAll(RETRIEVED_SOURCE)) retrievedSources.add(match[1]!)
        }
        break
      }
      case 'assistant/message':
        inputTokens += event.data.usage?.inputTokens ?? 0
        outputTokens += event.data.usage?.outputTokens ?? 0
        model = event.data.message?.source?.model ?? model
        break
      case 'turn/end':
        turnEnd = event.data.reason?.kind ?? 'unknown'
        turnErrorCode = typeof event.data.reason?.error?.code === 'string' ? event.data.reason.error.code : undefined
        break
      case 'permission/preset':
        permissionPreset = event.data.preset
        break
      default:
        // Other durable events carry nothing the report uses.
        break
    }
  }
  return {
    turns: events.filter(event => event.type === 'turn/start').length,
    steps: events.filter(event => event.type === 'step/start').length,
    toolCalls,
    retrievedSources: [...retrievedSources].sort(),
    inputTokens,
    outputTokens,
    turnEnd,
    model,
    permissionPreset,
    ...turnErrorCode === undefined ? {} : { turnErrorCode },
  }
}
