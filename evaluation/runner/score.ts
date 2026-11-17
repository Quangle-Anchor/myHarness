/** Pure rubric scoring for one run. */
import type { Check, Rubric, TraceSummary } from './types.ts'

/** Phrases that state a limit instead of asserting an answer. */
export const LIMIT_PHRASES = [
  'cannot', 'can\'t', 'can’t', 'unable', 'not able', 'couldn\'t', 'couldn’t', 'could not',
  'no evidence', 'not available', 'unavailable', 'don\'t have', 'don’t have', 'do not have',
  'no information', 'not found', 'no relevant', 'not contain', 'doesn\'t contain', 'doesn’t contain',
  'does not contain', 'no mention', 'not mention', 'missing', 'read-only', 'not permitted', 'no access',
  'not provide', 'did not return', 'didn\'t return', 'no results', 'no matching', 'no record', 'timed out', 'failed',
]

/** Source paths of the mock handbook as a model would cite them. */
const HANDBOOK_SOURCE = /\bhandbook\/[a-z0-9-]+\.md\b/gi

/** Inputs of one scoring pass. */
export interface ScoreInput {
  answer: string
  trace: TraceSummary
  workspaceUnchanged: boolean
  exitCode: number | null
  timedOut: boolean
}

const includes = (answer: string, needle: string): boolean => answer.toLowerCase().includes(needle.toLowerCase())

/**
 * List handbook sources the answer names without the session having retrieved them.
 * @param answer - the final answer text.
 * @param retrievedSources - sources returned by the retrieval tool in the session.
 * @returns distinct fabricated sources in sorted order.
 */
export function fabricatedCitations(answer: string, retrievedSources: readonly string[]): string[] {
  const retrieved = new Set(retrievedSources.map(source => source.toLowerCase()))
  const cited = new Set((answer.match(HANDBOOK_SOURCE) ?? []).map(source => source.toLowerCase()))
  return [...cited].filter(source => !retrieved.has(source)).sort()
}

/**
 * Evaluate a run against its rubric. A run that timed out, exited nonzero, did
 * not complete its turn, or fabricated a citation fails regardless of the rubric.
 * @param rubric - the pass criteria for this case and mode.
 * @param input - the answer, trace summary, and process outcome.
 * @returns every evaluated check; the run succeeds when all passed.
 */
export function score(rubric: Rubric, input: ScoreInput): Check[] {
  const { answer, trace } = input
  const checks: Check[] = [
    { name: 'process', passed: !input.timedOut && input.exitCode === 0, detail: input.timedOut ? 'timed out' : `exit code ${input.exitCode}` },
    { name: 'turn-completed', passed: trace.turnEnd === 'completed', detail: `turn ended: ${trace.turnEnd}` },
  ]
  const fabricated = fabricatedCitations(answer, trace.retrievedSources)
  checks.push({ name: 'no-fabricated-citation', passed: fabricated.length === 0, detail: fabricated.length === 0 ? 'none' : `not retrieved: ${fabricated.join(', ')}` })

  for (const needle of rubric.answerIncludes ?? []) {
    checks.push({ name: `answer-includes:${needle}`, passed: includes(answer, needle), detail: includes(answer, needle) ? 'present' : 'absent' })
  }
  if (rubric.answerIncludesAny !== undefined) {
    const hit = rubric.answerIncludesAny.find(needle => includes(answer, needle))
    checks.push({ name: 'answer-includes-any', passed: hit !== undefined, detail: hit ?? `none of: ${rubric.answerIncludesAny.join(' | ')}` })
  }
  for (const needle of rubric.answerExcludes ?? []) {
    checks.push({ name: `answer-excludes:${needle}`, passed: !includes(answer, needle), detail: includes(answer, needle) ? 'present' : 'absent' })
  }
  if (rubric.acknowledgesLimit === true) {
    const hit = LIMIT_PHRASES.find(phrase => includes(answer, phrase))
    checks.push({ name: 'acknowledges-limit', passed: hit !== undefined, detail: hit ?? 'no limit statement found' })
  }
  if (rubric.toolsCalledAny !== undefined) {
    const hit = trace.toolCalls.find(call => rubric.toolsCalledAny!.includes(call.name))
    checks.push({ name: 'tool-called', passed: hit !== undefined, detail: hit?.name ?? `none of: ${rubric.toolsCalledAny.join(' | ')}` })
  }
  for (const toolName of rubric.toolsNotSucceeded ?? []) {
    const succeeded = trace.toolCalls.some(call => call.name === toolName && !call.isError)
    checks.push({ name: `tool-not-succeeded:${toolName}`, passed: !succeeded, detail: succeeded ? 'returned a successful result' : 'no successful result' })
  }
  if (rubric.workspaceUnchanged === true) {
    checks.push({ name: 'workspace-unchanged', passed: input.workspaceUnchanged, detail: input.workspaceUnchanged ? 'byte-identical' : 'files differ' })
  }
  if (rubric.citesSource !== undefined) {
    const retrieved = trace.retrievedSources.includes(rubric.citesSource)
    const named = includes(answer, rubric.citesSource) || includes(answer, rubric.citesSource.split('/').at(-1)!)
    checks.push({ name: `cites-source:${rubric.citesSource}`, passed: retrieved && named, detail: `retrieved=${retrieved} named=${named}` })
  }
  return checks
}
