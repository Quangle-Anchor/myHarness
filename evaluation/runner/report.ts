/** Aggregates scored runs and renders the JSON, CSV, and Markdown reports. */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, ROOT } from '../../scripts/base.ts'
import type { EvalEngine, EvalMode, RunResult } from './types.ts'

/** Versions that identify what a report measured. */
export interface ReportMeta {
  generatedAt: string
  engine: EvalEngine
  upstreamVersion: string
  upstreamCommit: string
  bundles: Record<string, string>
  models: string[]
  node: string
}

/** Aggregate metrics of one mode. */
export interface ModeSummary {
  mode: EvalMode
  runs: number
  /** Runs the model provider refused; excluded from every other count. */
  inconclusive: number
  succeeded: number
  /** Successes over conclusive runs. */
  successRate: number
  /** Runs whose tool-selection checks all passed, over runs that had such checks. */
  toolCheckPassed: number
  toolCheckTotal: number
  fabricatedCitations: number
  /** Forbidden facts stated in the answer: failed `answer-excludes` checks. */
  unsupportedClaims: number
  timeouts: number
  toolErrors: number
  medianDurationMs: number
  p90DurationMs: number
  inputTokens: number
  outputTokens: number
}

export interface Report {
  meta: ReportMeta
  summary: ModeSummary[]
  results: RunResult[]
}

const readJson = (path: string): any => JSON.parse(readFileSync(path, 'utf8'))

const percentile = (sorted: number[], fraction: number): number => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]!

/**
 * Collect the versions a report depends on.
 * @param engine - the engine that produced the results.
 * @param results - scored runs, used for the model names they recorded.
 * @returns report metadata with the current time.
 */
export function collectMeta(engine: EvalEngine, results: readonly RunResult[]): ReportMeta {
  const commit = spawnSync('git', ['-C', BASE, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
  return {
    generatedAt: new Date().toISOString(),
    engine,
    upstreamVersion: readJson(join(BASE, 'package.json')).version,
    upstreamCommit: commit.status === 0 ? commit.stdout.trim() : 'unknown',
    bundles: Object.fromEntries(['core', 'rag'].map((bundle) => {
      const manifest = readJson(join(ROOT, 'bundles', bundle, 'package.json'))
      return [manifest.name, manifest.version]
    })),
    models: [...new Set(results.map(result => result.trace.model).filter((model): model is string => model !== undefined))].sort(),
    node: process.version,
  }
}

/**
 * Aggregate results per mode.
 * @param results - scored runs.
 * @returns one summary per mode present, in first-seen order.
 */
export function summarize(results: readonly RunResult[]): ModeSummary[] {
  const modes = [...new Set(results.map(result => result.mode))]
  return modes.map((mode) => {
    const all = results.filter(result => result.mode === mode)
    const runs = all.filter(result => result.providerError === undefined)
    const toolRuns = runs.filter(run => run.checks.some(check => check.name.startsWith('tool-')))
    const durations = runs.map(run => run.durationMs).sort((a, b) => a - b)
    return {
      mode,
      runs: all.length,
      inconclusive: all.length - runs.length,
      succeeded: runs.filter(run => run.success).length,
      successRate: runs.length === 0 ? 0 : Number((runs.filter(run => run.success).length / runs.length).toFixed(3)),
      toolCheckPassed: toolRuns.filter(run => run.checks.filter(check => check.name.startsWith('tool-')).every(check => check.passed)).length,
      toolCheckTotal: toolRuns.length,
      fabricatedCitations: runs.reduce((sum, run) => sum + run.fabricatedCitations.length, 0),
      unsupportedClaims: runs.reduce((sum, run) => sum + run.checks.filter(check => check.name.startsWith('answer-excludes:') && !check.passed).length, 0),
      timeouts: runs.filter(run => run.timedOut).length,
      toolErrors: runs.reduce((sum, run) => sum + run.trace.toolCalls.filter(call => call.isError).length, 0),
      medianDurationMs: percentile(durations, 0.5),
      p90DurationMs: percentile(durations, 0.9),
      inputTokens: runs.reduce((sum, run) => sum + run.trace.inputTokens, 0),
      outputTokens: runs.reduce((sum, run) => sum + run.trace.outputTokens, 0),
    }
  })
}

const csvCell = (value: unknown): string => {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * Render one row per run.
 * @param results - scored runs.
 * @returns CSV text with a header row and a trailing newline.
 */
export function toCsv(results: readonly RunResult[]): string {
  const header = ['case', 'category', 'mode', 'success', 'provider_error', 'attempts', 'failed_checks', 'steps', 'tool_calls', 'tool_errors', 'fabricated_citations', 'duration_ms', 'input_tokens', 'output_tokens', 'turn_end', 'trace']
  const rows = results.map(result => [
    result.caseId,
    result.category,
    result.mode,
    result.success,
    result.providerError ?? '',
    result.attempts,
    result.checks.filter(check => !check.passed).map(check => check.name).join('; '),
    result.trace.steps,
    result.trace.toolCalls.map(call => call.name).join(' '),
    result.trace.toolCalls.filter(call => call.isError).length,
    result.fabricatedCitations.join(' '),
    result.durationMs,
    result.trace.inputTokens,
    result.trace.outputTokens,
    result.trace.turnEnd,
    result.traceFile ?? '',
  ])
  return `${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\n')}\n`
}

const oneLine = (text: string, limit: number): string => {
  const flat = text.replaceAll(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

/**
 * Render the human-readable report: versions, per-mode metrics, a case matrix, and every failure with its reasons.
 * @param report - metadata, summaries, and results.
 * @returns Markdown text with a trailing newline.
 */
export function toMarkdown(report: Report): string {
  const { meta, summary, results } = report
  const modes = summary.map(item => item.mode)
  const cases = [...new Set(results.map(result => result.caseId))]
  const cell = (caseId: string, mode: EvalMode): string => {
    const result = results.find(item => item.caseId === caseId && item.mode === mode)
    return result === undefined ? '–' : result.providerError !== undefined ? `n/a (${result.providerError})` : result.success ? 'pass' : 'FAIL'
  }
  const failures = results.filter(result => !result.success && result.providerError === undefined)
  const inconclusive = results.filter(result => result.providerError !== undefined)
  const lines = [
    `# Evaluation report (${meta.engine})`,
    '',
    `- Generated: ${meta.generatedAt}`,
    `- Upstream: DeepSeek Harness ${meta.upstreamVersion} at \`${meta.upstreamCommit}\``,
    `- Bundles: ${Object.entries(meta.bundles).map(([name, version]) => `${name} ${version}`).join(', ')}`,
    `- Model: ${meta.models.join(', ') || 'none recorded'}`,
    `- Node: ${meta.node}`,
    '',
    meta.engine === 'scripted'
      ? 'The scripted engine replays fixed model outputs. It measures the harness, the policy plugins, and this runner; it says nothing about model quality.'
      : 'The live engine calls the configured model. Results vary between runs; the retrieval service is the mock server in every mode.',
    '',
    '## Metrics by mode',
    '',
    '| Mode | Runs | Inconclusive | Success | Tool checks | Fabricated citations | Unsupported claims | Timeouts | Tool errors | Median s | p90 s | Input tokens | Output tokens |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...summary.map(item => `| ${item.mode} | ${item.runs} | ${item.inconclusive} | ${item.succeeded}/${item.runs - item.inconclusive} (${(item.successRate * 100).toFixed(1)}%) | ${item.toolCheckPassed}/${item.toolCheckTotal} | ${item.fabricatedCitations} | ${item.unsupportedClaims} | ${item.timeouts} | ${item.toolErrors} | ${(item.medianDurationMs / 1000).toFixed(1)} | ${(item.p90DurationMs / 1000).toFixed(1)} | ${item.inputTokens} | ${item.outputTokens} |`),
    '',
    'A run the model provider refused (quota, rate limit, credentials) is inconclusive: it measured nothing about the agent and is excluded from every other column. Success is the share of conclusive runs whose rubric checks all passed. Context cases expect the handbook fact with its source in `rag-on` and an explicit statement of missing evidence in the other modes, so a mode without retrieval can still succeed on them. Tool errors include deliberate ones: refused writes, denied operator tools, and scripted retrieval failures.',
    '',
    '## Cases',
    '',
    `| Case | Category | ${modes.join(' | ')} |`,
    `|---|---|${modes.map(() => '---').join('|')}|`,
    ...cases.map(caseId => `| ${caseId} | ${results.find(result => result.caseId === caseId)!.category} | ${modes.map(mode => cell(caseId, mode)).join(' | ')} |`),
    '',
    `## Failures (${failures.length})`,
    '',
    ...(failures.length === 0
      ? ['None.']
      : failures.flatMap(result => [
          `### ${result.caseId} — ${result.mode}`,
          '',
          ...result.checks.filter(check => !check.passed).map(check => `- \`${check.name}\`: ${check.detail}`),
          `- Tools: ${result.trace.toolCalls.map(call => `${call.name}${call.isError ? ' (error)' : ''}`).join(', ') || 'none'}`,
          `- Answer: ${oneLine(result.answer, 400) || '(empty)'}`,
          ...(result.traceFile === undefined ? [] : [`- Trace: \`${result.traceFile}\``]),
          '',
        ])),
    ...(inconclusive.length === 0
      ? []
      : ['', `## Inconclusive (${inconclusive.length})`, '', ...inconclusive.map(result => `- ${result.caseId} — ${result.mode}: provider error \`${result.providerError}\` after ${result.attempts} attempt${result.attempts > 1 ? 's' : ''}`)]),
  ]
  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * Project a report onto the fields that must be identical between two scripted runs.
 * @param report - a complete report.
 * @returns results without timings, session identities, and generation time.
 */
export function stableView(report: Report): unknown {
  return {
    meta: { ...report.meta, generatedAt: undefined },
    results: report.results.map(result => ({
      caseId: result.caseId,
      mode: result.mode,
      success: result.success,
      providerError: result.providerError,
      checks: result.checks,
      answer: result.answer,
      fabricatedCitations: result.fabricatedCitations,
      serviceCalls: result.serviceCalls,
      exitCode: result.exitCode,
      tools: result.trace.toolCalls.map(call => ({ name: call.name, isError: call.isError, errorCode: call.errorCode })),
      retrievedSources: result.trace.retrievedSources,
      steps: result.trace.steps,
      turnEnd: result.trace.turnEnd,
    })),
  }
}
