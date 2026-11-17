import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fabricatedCitations, score } from '../../evaluation/runner/score.ts'
import { summarizeTrace } from '../../evaluation/runner/trace.ts'
import type { TraceSummary } from '../../evaluation/runner/types.ts'

const trace = (overrides: Partial<TraceSummary> = {}): TraceSummary => ({
  turns: 1, steps: 2, toolCalls: [], retrievedSources: [], inputTokens: 0, outputTokens: 0, turnEnd: 'completed', model: 'm', permissionPreset: 'read-only', ...overrides,
})
const ok = { workspaceUnchanged: true, exitCode: 0, timedOut: false }
const failed = (checks: ReturnType<typeof score>): string[] => checks.filter(check => !check.passed).map(check => check.name)

test('a citation counts as fabricated unless the session retrieved that source', () => {
  assert.deepEqual(fabricatedCitations('See handbook/refunds.md and Handbook/Carriers.md.', ['handbook/refunds.md']), ['handbook/carriers.md'])
  assert.deepEqual(fabricatedCitations('No source named.', []), [])
})

test('a fabricated citation fails a run whose rubric is otherwise satisfied', () => {
  const checks = score({ answerIncludes: ['750'] }, { ...ok, answer: 'The ceiling is 750 EUR (handbook/refunds.md).', trace: trace() })
  assert.deepEqual(failed(checks), ['no-fabricated-citation'])
})

test('a timeout, a nonzero exit, and an unfinished turn each fail the run', () => {
  assert.deepEqual(failed(score({}, { ...ok, timedOut: true, answer: '', trace: trace() })), ['process'])
  assert.deepEqual(failed(score({}, { ...ok, exitCode: 1, answer: '', trace: trace() })), ['process'])
  assert.deepEqual(failed(score({}, { ...ok, answer: '', trace: trace({ turnEnd: 'missing' }) })), ['turn-completed'])
})

test('answer checks are case-insensitive', () => {
  const checks = score({ answerIncludes: ['verifytoken'], answerExcludes: ['northwind'], answerIncludesAny: ['two', '2'] }, { ...ok, answer: 'VerifyToken handles it for Two users.', trace: trace() })
  assert.deepEqual(failed(checks), [])
})

test('a denied tool call does not count as a successful call', () => {
  const denied = trace({ toolCalls: [{ name: 'mcp__rag__sync_documents', isError: true, durationMs: 1 }] })
  assert.deepEqual(failed(score({ toolsNotSucceeded: ['mcp__rag__sync_documents'] }, { ...ok, answer: '', trace: denied })), [])
  const succeeded = trace({ toolCalls: [{ name: 'mcp__rag__sync_documents', isError: false, durationMs: 1 }] })
  assert.deepEqual(failed(score({ toolsNotSucceeded: ['mcp__rag__sync_documents'] }, { ...ok, answer: '', trace: succeeded })), ['tool-not-succeeded:mcp__rag__sync_documents'])
})

test('a cited source must be both retrieved and named', () => {
  const rubric = { citesSource: 'handbook/refunds.md' }
  assert.deepEqual(failed(score(rubric, { ...ok, answer: 'Per refunds.md, 9 days.', trace: trace({ retrievedSources: ['handbook/refunds.md'] }) })), [])
  assert.deepEqual(failed(score(rubric, { ...ok, answer: '9 days.', trace: trace({ retrievedSources: ['handbook/refunds.md'] }) })), ['cites-source:handbook/refunds.md'])
})

test('a changed workspace and a missing limit statement are reported', () => {
  const checks = score({ workspaceUnchanged: true, acknowledgesLimit: true }, { ...ok, workspaceUnchanged: false, answer: 'I created the file.', trace: trace() })
  assert.deepEqual(failed(checks), ['acknowledges-limit', 'workspace-unchanged'])
})

test('a trace summary pairs calls with results and collects retrieved sources and usage', () => {
  const summary = summarizeTrace([
    { type: 'permission/preset', seq: 1, time: 0, data: { preset: 'read-only' } },
    { type: 'turn/start', seq: 2, time: 0, data: {} },
    { type: 'step/start', seq: 3, time: 0, data: {} },
    { type: 'assistant/message', seq: 4, time: 5, data: { usage: { inputTokens: 100, outputTokens: 7 }, message: { source: { model: 'gemini' } } } },
    { type: 'tool/call', seq: 5, time: 10, data: { callId: 'c1', name: 'mcp__rag__retrieve_context', arguments: '{}' } },
    { type: 'tool/result', seq: 6, time: 35, data: { message: { toolCallId: 'c1', isError: false, content: [{ type: 'text', text: '<retrieved_context>\n[1] source="handbook/refunds.md" id="x"\ntext\n\n[2] source="handbook/carriers.md"\ntext' }] } } },
    { type: 'tool/call', seq: 7, time: 40, data: { callId: 'c2', name: 'write', arguments: '{}' } },
    { type: 'tool/result', seq: 8, time: 41, data: { message: { toolCallId: 'c2', isError: true, content: [] }, error: { code: 'DENIED' } } },
    { type: 'turn/end', seq: 9, time: 50, data: { reason: { kind: 'completed' } } },
  ], 'mcp__rag__retrieve_context')
  assert.deepEqual(summary.toolCalls, [
    { name: 'mcp__rag__retrieve_context', isError: false, durationMs: 25 },
    { name: 'write', isError: true, durationMs: 1, errorCode: 'DENIED' },
  ])
  assert.deepEqual(summary.retrievedSources, ['handbook/carriers.md', 'handbook/refunds.md'])
  assert.deepEqual([summary.turns, summary.steps, summary.inputTokens, summary.outputTokens, summary.turnEnd, summary.model, summary.permissionPreset], [1, 1, 100, 7, 'completed', 'gemini', 'read-only'])
})
