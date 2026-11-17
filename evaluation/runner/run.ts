/** Executes evaluation cases through the real `dsh` CLI and scores each run. */
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { startMockRag } from '../../mock-rag/server.ts'
import { DEAD_RAG_URL, HOME, makeWorkspace, runAgent, SCRIPTED_MODEL_OVERLAY, startScriptedModel, treeDigest } from '../../tests/harness.ts'
import { fabricatedCitations, score } from './score.ts'
import { summarizeTrace } from './trace.ts'
import type { EvalCase, EvalEngine, EvalMode, RunResult } from './types.ts'

export const RETRIEVE_TOOL = 'mcp__rag__retrieve_context'

/** Headless profile used by each mode. */
export const PROFILE_BY_MODE: Record<EvalMode, string> = {
  'core-only': 'map-core-headless',
  'rag-on': 'map-rag-headless',
  'rag-offline': 'map-rag-headless',
}

/** Provider refusals that say nothing about the agent and are worth retrying after a pause. */
export const PROVIDER_ERROR_CODES: readonly string[] = ['QUOTA', 'RATE_LIMIT', 'RATE_LIMITED', 'OVERLOADED', 'SERVICE_UNAVAILABLE', 'MISSING_CREDENTIAL', 'AUTH']

export interface RunSettings {
  engine: EvalEngine
  /** Extra `--patch` overlays applied to every run. */
  patches: string[]
  /** Attempts per run when the provider refuses it. */
  maxAttempts: number
  /** Pause before retrying a refused run. */
  retryDelayMs: number
  /** Report directory; session logs are copied to `<outDir>/traces`. */
  outDir: string
  /** Deadline of one retrieval call in `rag-on`. */
  ragTimeoutMs: number
  /** Deadline of one whole agent run. */
  runTimeoutMs: number
}

/** Locate the session directory of a session id under the plain-log root. */
function sessionLogPath(sessionId: string): string | undefined {
  const root = join(HOME, 'sessions-plain')
  for (const group of readdirSync(root)) {
    const dir = join(root, group, sessionId)
    try {
      const file = readdirSync(dir).filter(name => name.endsWith('.jsonl')).sort().at(-1)
      if (file !== undefined) return join(dir, file)
    }
    catch {
      // ENOENT: the session belongs to another workspace group.
      continue
    }
  }
  return undefined
}

/**
 * Run one case in one mode and score it.
 * @param evalCase - the case to run.
 * @param mode - retrieval-service condition.
 * @param settings - engine, deadlines, and report directory.
 * @returns the scored result with its trace summary.
 */
export async function runCase(evalCase: EvalCase, mode: EvalMode, settings: RunSettings): Promise<RunResult> {
  let result = await attemptCase(evalCase, mode, settings)
  while (result.providerError !== undefined && result.attempts < settings.maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, settings.retryDelayMs))
    result = { ...await attemptCase(evalCase, mode, settings), attempts: result.attempts + 1 }
  }
  return result
}

async function attemptCase(evalCase: EvalCase, mode: EvalMode, settings: RunSettings): Promise<RunResult> {
  const workspace = makeWorkspace()
  const rag = mode === 'rag-on'
    ? await startMockRag({ port: 0, mode: evalCase.ragMode ?? 'ok', timeoutDelayMs: settings.ragTimeoutMs * 4 })
    : undefined
  const model = settings.engine === 'scripted'
    ? await startScriptedModel(evalCase.script ?? { finalText: '' })
    : undefined
  try {
    const before = treeDigest(workspace.dir)
    const env: Record<string, string> = { ...model?.env }
    if (mode !== 'core-only') {
      env.MAP_RAG_URL = rag?.url ?? DEAD_RAG_URL
      env.MAP_RAG_TIMEOUT_MS = String(settings.ragTimeoutMs)
    }
    const run = await runAgent({
      profile: PROFILE_BY_MODE[mode],
      task: evalCase.task,
      workspace: workspace.dir,
      patches: [...settings.patches, ...model === undefined ? [] : [SCRIPTED_MODEL_OVERLAY]],
      env,
      timeoutMs: settings.runTimeoutMs,
    })
    const answer = run.stdout.trim()
    const trace = summarizeTrace(run.events, RETRIEVE_TOOL)
    const checks = score(evalCase.expect[mode] ?? evalCase.expect.default, {
      answer,
      trace,
      workspaceUnchanged: treeDigest(workspace.dir) === before,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
    })
    const serviceCalls = (rag?.calls ?? []).map(call => call.tool)
    if (rag !== undefined) {
      const synced = serviceCalls.includes('sync_documents')
      checks.push({ name: 'service-received-no-sync', passed: !synced, detail: synced ? 'sync_documents reached the service' : 'none' })
    }
    let traceFile: string | undefined
    const logPath = run.sessionId === undefined ? undefined : sessionLogPath(run.sessionId)
    if (logPath !== undefined) {
      traceFile = join('traces', `${evalCase.id}.${mode}.jsonl`)
      mkdirSync(join(settings.outDir, 'traces'), { recursive: true })
      copyFileSync(logPath, join(settings.outDir, traceFile))
    }
    const providerError = trace.turnErrorCode !== undefined && PROVIDER_ERROR_CODES.includes(trace.turnErrorCode) ? trace.turnErrorCode : undefined
    return {
      caseId: evalCase.id,
      category: evalCase.category,
      mode,
      success: providerError === undefined && checks.every(check => check.passed),
      ...providerError === undefined ? {} : { providerError },
      attempts: 1,
      checks,
      fabricatedCitations: fabricatedCitations(answer, trace.retrievedSources),
      serviceCalls,
      answer,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      durationMs: run.durationMs,
      trace,
      sessionId: run.sessionId,
      traceFile,
    }
  }
  finally {
    workspace.remove()
    await model?.close()
    await rag?.close()
  }
}

/** Scheduling of a whole evaluation. */
export interface Schedule {
  /** Runs in flight at once. */
  concurrency: number
  /** Model requests allowed per rolling minute; 0 disables pacing. */
  requestsPerMinute: number
  /** Requests assumed for a run before it has been observed. */
  requestsPerRunEstimate: number
}

/**
 * Run every case in every mode. Completed results passed in `done` are reused,
 * and model requests are paced under the provider's per-minute limit.
 * @param cases - cases to run.
 * @param modes - modes to run each case in.
 * @param settings - engine, deadlines, overlays, and report directory.
 * @param schedule - concurrency and request pacing.
 * @param done - conclusive results from an earlier, interrupted evaluation.
 * @param onResult - called after each run settles, with every result so far.
 * @returns results ordered by case, then mode.
 */
export async function runAll(cases: readonly EvalCase[], modes: readonly EvalMode[], settings: RunSettings, schedule: Schedule, done: readonly RunResult[], onResult: (result: RunResult, all: RunResult[]) => void): Promise<RunResult[]> {
  const jobs = cases.flatMap((evalCase, caseIndex) => modes.map((mode, modeIndex) => ({ evalCase, mode, order: caseIndex * modes.length + modeIndex })))
  const results: Array<RunResult | undefined> = jobs.map(job => done.find(result => result.caseId === job.evalCase.id && result.mode === job.mode && result.providerError === undefined))
  const pending = jobs.filter(job => results[job.order] === undefined)

  // Requests are attributed to the moment their run was admitted.
  const spent: Array<{ at: number, requests: number }> = []
  const admit = async (): Promise<{ at: number, requests: number }> => {
    for (;;) {
      const now = Date.now()
      while (spent.length > 0 && now - spent[0]!.at >= 60_000) spent.shift()
      const used = spent.reduce((sum, entry) => sum + entry.requests, 0)
      if (schedule.requestsPerMinute === 0 || used + schedule.requestsPerRunEstimate <= schedule.requestsPerMinute || spent.length === 0) {
        const entry = { at: now, requests: schedule.requestsPerRunEstimate }
        spent.push(entry)
        return entry
      }
      await new Promise(resolve => setTimeout(resolve, 60_000 - (now - spent[0]!.at) + 250))
    }
  }

  let next = 0
  const worker = async (): Promise<void> => {
    while (next < pending.length) {
      const job = pending[next++]!
      const budget = await admit()
      const result = await runCase(job.evalCase, job.mode, settings)
      budget.requests = Math.max(1, result.trace.steps) * result.attempts
      results[job.order] = result
      onResult(result, results.filter((item): item is RunResult => item !== undefined))
    }
  }
  await Promise.all(Array.from({ length: Math.min(schedule.concurrency, pending.length) }, worker))
  return results.filter((item): item is RunResult => item !== undefined)
}
