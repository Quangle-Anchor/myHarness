/** Shared types of the evaluation runner. This file holds types only. */

/** How the retrieval service behaves for a run. */
export type EvalMode = 'core-only' | 'rag-on' | 'rag-offline'

/** Which model answers: the configured provider, or the scripted Messages server. */
export type EvalEngine = 'live' | 'scripted'

/** Pass criteria for one run. Every stated field must hold. */
export interface Rubric {
  /** Each string must occur in the final answer (case-insensitive). */
  answerIncludes?: string[]
  /** At least one string must occur in the final answer (case-insensitive). */
  answerIncludesAny?: string[]
  /** No string may occur in the final answer (case-insensitive). */
  answerExcludes?: string[]
  /** The answer must state a limit: missing evidence, an unavailable tool, or a refused action. */
  acknowledgesLimit?: boolean
  /** At least one of these tools must have been called. */
  toolsCalledAny?: string[]
  /** None of these tools may have returned a successful result. */
  toolsNotSucceeded?: string[]
  /** The workspace must be byte-identical after the run. */
  workspaceUnchanged?: boolean
  /** The answer must name this source, and the session must have retrieved it. */
  citesSource?: string
}

/** One evaluation case. */
export interface EvalCase {
  id: string
  category: 'core' | 'context' | 'negative'
  task: string
  /** Mock retrieval behavior in `rag-on`; defaults to `ok`. */
  ragMode?: 'ok' | 'empty' | 'timeout' | 'error' | 'injection' | 'oversize'
  /** Rubric per mode; `default` applies to modes without their own entry. */
  expect: { default: Rubric } & Partial<Record<EvalMode, Rubric>>
  /** Scripted engine only: the single tool call and the final answer the scripted model produces. */
  script?: { toolName?: string, toolArguments?: unknown, finalText: string }
}

/** One tool call as recorded in the session log. */
export interface ToolCallSummary {
  name: string
  isError: boolean
  errorCode?: string
  durationMs: number
}

/** Facts derived from one session log. */
export interface TraceSummary {
  turns: number
  steps: number
  toolCalls: ToolCallSummary[]
  /** `source` values of passages the retrieval tool returned in this session. */
  retrievedSources: string[]
  inputTokens: number
  outputTokens: number
  /** Reason of the last `turn/end`, or `missing` when the log has none. */
  turnEnd: string
  /** Error code of the last `turn/end` when it ended in an error, such as `QUOTA`. */
  turnErrorCode?: string
  model: string | undefined
  permissionPreset: string | undefined
}

/** One named rubric check and its outcome. */
export interface Check {
  name: string
  passed: boolean
  detail: string
}

/** The scored outcome of one case in one mode. */
export interface RunResult {
  caseId: string
  category: EvalCase['category']
  mode: EvalMode
  success: boolean
  /**
   * Set when the model provider refused the run (quota, rate limit, credentials).
   * Such a run measured nothing about the agent and is reported as inconclusive.
   */
  providerError?: string
  /** Attempts made, including retries after a provider refusal. */
  attempts: number
  checks: Check[]
  /** Handbook-style sources named in the answer that the session never retrieved. */
  fabricatedCitations: string[]
  /** Tool calls the retrieval service received, by raw tool name. */
  serviceCalls: string[]
  answer: string
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  trace: TraceSummary
  sessionId: string | undefined
  /** Session log copied beside the report, relative to the report directory. */
  traceFile: string | undefined
}
