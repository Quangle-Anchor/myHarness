/**
 * Evaluation entry point.
 *   node evaluation/runner/cli.ts [--engine live|scripted] [--modes core-only,rag-on,rag-offline]
 *                                 [--cases <id-substring>] [--concurrency <n>] [--rpm <n>] [--resume] [--out <dir>]
 * `--rpm` paces model requests under the provider's per-minute limit (live default 12; 0 disables).
 * `--resume` keeps the conclusive results already in the output directory and runs the rest.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ROOT } from '../../scripts/base.ts'
import { HAS_LIVE_KEY } from '../../tests/harness.ts'
import { collectMeta, summarize, toCsv, toMarkdown, type Report } from './report.ts'
import { runAll } from './run.ts'
import type { EvalCase, EvalEngine, EvalMode, RunResult } from './types.ts'

const ALL_MODES: EvalMode[] = ['core-only', 'rag-on', 'rag-offline']

/** Options of one evaluation. */
export interface EvaluateOptions {
  engine: EvalEngine
  modes: EvalMode[]
  /** Keep only cases whose id contains this text. */
  filter?: string
  concurrency: number
  /** Model requests per rolling minute; 0 disables pacing. */
  requestsPerMinute: number
  /** Reuse conclusive results found in `outDir`. */
  resume: boolean
  outDir: string
}

/**
 * Run an evaluation and write `report.json`, `report.csv`, `report.md`, and the session traces.
 * The three report files are rewritten after every run, so an interrupted evaluation can resume.
 * @param options - engine, modes, case filter, scheduling, and output directory.
 * @param log - progress sink, one line per finished run.
 * @returns the complete report.
 */
export async function evaluate(options: EvaluateOptions, log: (line: string) => void = () => {}): Promise<Report> {
  const all: EvalCase[] = JSON.parse(readFileSync(join(ROOT, 'evaluation', 'cases', `${options.engine}.json`), 'utf8'))
  const cases = options.filter === undefined ? all : all.filter(evalCase => evalCase.id.includes(options.filter!))
  if (cases.length === 0) throw new Error(`no case id contains "${options.filter}"`)
  const reportPath = join(options.outDir, 'report.json')
  const done: RunResult[] = options.resume && existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')).results : []
  if (!options.resume) rmSync(options.outDir, { recursive: true, force: true })
  mkdirSync(options.outDir, { recursive: true })

  const write = (results: RunResult[]): Report => {
    const report: Report = { meta: collectMeta(options.engine, results), summary: summarize(results), results }
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    writeFileSync(join(options.outDir, 'report.csv'), toCsv(results))
    writeFileSync(join(options.outDir, 'report.md'), toMarkdown(report))
    return report
  }
  const live = options.engine === 'live'
  const results = await runAll(cases, options.modes, {
    engine: options.engine,
    outDir: options.outDir,
    patches: live ? [join(ROOT, 'evaluation', 'overlays', 'no-title.yml')] : [],
    maxAttempts: live ? 3 : 1,
    retryDelayMs: 62_000,
    ragTimeoutMs: live ? 4000 : 1500,
    runTimeoutMs: live ? 180_000 : 60_000,
  }, {
    concurrency: options.concurrency,
    requestsPerMinute: options.requestsPerMinute,
    requestsPerRunEstimate: 4,
  }, done, (result, soFar) => {
    const failed = result.checks.filter(check => !check.passed).map(check => check.name)
    const status = result.providerError !== undefined ? `n/a (${result.providerError})` : result.success ? 'pass' : 'FAIL'
    log(`${status}  ${result.caseId}  ${result.mode}  ${(result.durationMs / 1000).toFixed(1)}s${result.providerError === undefined && failed.length > 0 ? `  [${failed.join(', ')}]` : ''}`)
    write(soFar)
  })
  return write(results)
}

if (process.argv[1] === import.meta.filename) {
  const { values } = parseArgs({
    options: {
      engine: { type: 'string', default: 'live' },
      modes: { type: 'string', default: ALL_MODES.join(',') },
      cases: { type: 'string' },
      concurrency: { type: 'string' },
      rpm: { type: 'string' },
      resume: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  })
  const engine = values.engine as EvalEngine
  if (engine !== 'live' && engine !== 'scripted') throw new Error(`--engine must be "live" or "scripted", got "${values.engine}"`)
  const modes = values.modes.split(',') as EvalMode[]
  const unknown = modes.filter(mode => !ALL_MODES.includes(mode))
  if (unknown.length > 0) throw new Error(`unknown mode: ${unknown.join(', ')}; expected ${ALL_MODES.join(', ')}`)
  if (engine === 'live' && !HAS_LIVE_KEY) {
    console.error('eval: the live engine needs GEMINI_API_KEY in the environment or in .env; use --engine scripted for a keyless run')
    process.exit(2)
  }
  const outDir = resolve(values.out ?? join(ROOT, 'evaluation', 'reports', `${engine}-latest`))
  const report = await evaluate({
    engine,
    modes,
    ...(values.cases === undefined ? {} : { filter: values.cases }),
    concurrency: Number(values.concurrency ?? (engine === 'scripted' ? 4 : 2)),
    requestsPerMinute: Number(values.rpm ?? (engine === 'scripted' ? 0 : 12)),
    resume: values.resume,
    outDir,
  }, line => console.log(line))
  console.log('')
  for (const item of report.summary) console.log(`${item.mode}: ${item.succeeded}/${item.runs - item.inconclusive} succeeded${item.inconclusive > 0 ? `, ${item.inconclusive} inconclusive` : ''}`)
  console.log(`report: ${join(outDir, 'report.md')}`)
}
