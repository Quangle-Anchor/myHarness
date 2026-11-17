/**
 * Optional RAG bundle, keyless: the real CLI and profile, a scripted model, and
 * the mock retrieval service. Covers T06 to T11 of the V1 test plan.
 */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { INJECTION_CHUNK, startMockRag, type MockRag } from '../../mock-rag/server.ts'
import { DEAD_RAG_URL, makeWorkspace, runAgent, SCRIPTED_MODEL_OVERLAY, startScriptedModel, toolTraces, treeDigest, turnEndReasons, type AgentRun } from '../harness.ts'

const PROFILE = 'map-rag-headless'
const RETRIEVE = 'mcp__rag__retrieve_context'
const SYNC = 'mcp__rag__sync_documents'

let rag: MockRag
before(async () => { rag = await startMockRag({ port: 0, mode: 'ok', timeoutDelayMs: 30_000 }) })
after(async () => { await rag.close() })

/** Run one scripted tool call against the RAG profile and return the run with what the model was offered. */
async function scripted(call: { toolName?: string, toolArguments?: unknown }, env: Record<string, string> = {}): Promise<{ run: AgentRun, offered: string[], workspaceUnchanged: boolean }> {
  const model = await startScriptedModel(call)
  const ws = makeWorkspace()
  try {
    const digest = treeDigest(ws.dir)
    const run = await runAgent({ profile: PROFILE, task: 'scripted task', workspace: ws.dir, patches: [SCRIPTED_MODEL_OVERLAY], env: { MAP_RAG_URL: rag.url, ...model.env, ...env } })
    return { run, offered: model.offeredTools(), workspaceUnchanged: treeDigest(ws.dir) === digest }
  }
  finally {
    ws.remove()
    await model.close()
  }
}

test('T06 the retrieval tool is offered and returns evidence with its real source metadata', async () => {
  rag.setMode('ok')
  const { run, offered } = await scripted({ toolName: RETRIEVE, toolArguments: { query: 'lost parcel refund ceiling' } })
  assert.equal(run.exitCode, 0, run.stderr)
  assert.ok(offered.includes(RETRIEVE))
  const [trace] = toolTraces(run.events)
  assert.equal(trace?.isError, false)
  assert.match(trace!.text, /^<retrieved_context provider="rag" trust="untrusted">/)
  assert.match(trace!.text, /source="handbook\/refunds\.md"/)
  assert.match(trace!.text, /ceiling of 750 EUR/)
})

test('T07 the agent starts and answers when the retrieval service is down at startup', async () => {
  const { run, offered } = await scripted({ toolName: 'capability_status' }, { MAP_RAG_URL: DEAD_RAG_URL })
  assert.equal(run.exitCode, 0, run.stderr)
  assert.deepEqual(offered.filter(name => name.startsWith('mcp__')), [], 'no retrieval tool is offered')
  const [trace] = toolTraces(run.events)
  assert.equal(trace?.isError, false)
  assert.match(trace!.text, /Context provider "rag" is unavailable/)
  assert.deepEqual(turnEndReasons(run.events), ['completed'])
})

test('T08 a retrieval timeout becomes one logged tool error and the turn still ends', async () => {
  rag.setMode('timeout')
  const before = rag.calls.length
  const { run } = await scripted({ toolName: RETRIEVE, toolArguments: { query: 'carrier service levels' } }, { MAP_RAG_TIMEOUT_MS: '1500' })
  assert.equal(run.timedOut, false)
  assert.equal(run.exitCode, 0, run.stderr)
  const traces = toolTraces(run.events)
  assert.equal(traces.length, 1)
  assert.equal(traces[0]!.isError, true)
  assert.match(traces[0]!.text, /time|abort/i)
  assert.equal(rag.calls.length - before, 1, 'the harness did not retry on its own')
  assert.deepEqual(turnEndReasons(run.events), ['completed'])
  assert.ok(run.durationMs < 20_000, `bounded by the tool deadline, took ${run.durationMs}ms`)
})

test('T08 a retrieval backend error is reported as a tool error', async () => {
  rag.setMode('error')
  const { run } = await scripted({ toolName: RETRIEVE, toolArguments: { query: 'anything' } })
  const [trace] = toolTraces(run.events)
  assert.equal(trace?.isError, true)
  assert.match(trace!.text, /retrieval backend unavailable/)
  assert.doesNotMatch(trace!.text, /<retrieved_context/)
})

test('T09 an empty retrieval states that there is no evidence and names no source', async () => {
  rag.setMode('empty')
  const { run } = await scripted({ toolName: RETRIEVE, toolArguments: { query: 'lost parcel refund' } })
  const [trace] = toolTraces(run.events)
  assert.equal(trace?.isError, false)
  assert.match(trace!.text, /returned no evidence/)
  assert.doesNotMatch(trace!.text, /source=|handbook\//)
})

test('T10 a hostile passage reaches the model only as labelled data and triggers nothing by itself', async () => {
  rag.setMode('injection')
  const before = rag.calls.length
  const { run, workspaceUnchanged } = await scripted({ toolName: RETRIEVE, toolArguments: { query: 'lost parcel refund' } })
  const traces = toolTraces(run.events)
  assert.equal(traces.length, 1, 'the retrieval result caused no further tool call')
  assert.ok(traces[0]!.text.includes(INJECTION_CHUNK.text), 'the passage is delivered unmodified as data')
  assert.ok(traces[0]!.text.indexOf('not instructions') < traces[0]!.text.indexOf(INJECTION_CHUNK.text), 'the untrusted-data statement precedes the passage')
  assert.deepEqual(rag.calls.slice(before).map(call => call.tool), ['retrieve_context'])
  assert.equal(workspaceUnchanged, true)
})

test('T10 an oversized retrieval is cut to the configured limits with a warning', async () => {
  rag.setMode('oversize')
  const { run } = await scripted({ toolName: RETRIEVE, toolArguments: { query: 'anything' } })
  const [trace] = toolTraces(run.events)
  assert.equal(trace?.isError, false)
  // Defaults: 5 passages, 1500 characters each, 6000 in total. Four full passages exhaust the total.
  assert.equal(trace!.text.match(/^\[\d+\] source=/gm)?.length, 4)
  assert.match(trace!.text, /Warning: 36 of 40 retrieved passages were dropped/)
  assert.match(trace!.text, /Warning: 4 passages were truncated\./)
  assert.ok(trace!.text.length < 6000 + 1500, `passages stay within maxTotalChars plus the fixed wrapper, got ${trace!.text.length}`)
})

test('T11 sync_documents is not offered to the model', async () => {
  rag.setMode('ok')
  const { offered } = await scripted({})
  assert.ok(offered.includes(RETRIEVE))
  assert.ok(!offered.includes(SYNC))
})

test('T11 a direct sync_documents call is denied before it reaches the service', async () => {
  rag.setMode('ok')
  const before = rag.calls.length
  const { run } = await scripted({ toolName: SYNC })
  const [trace] = toolTraces(run.events)
  assert.equal(trace?.name, SYNC)
  assert.equal(trace?.isError, true)
  assert.equal(trace?.errorCode, 'MAP_OPERATOR_ONLY_TOOL')
  assert.deepEqual(rag.calls.slice(before), [], 'the service received nothing')
  assert.deepEqual(turnEndReasons(run.events), ['completed'])
})

test('T11 capability_status lists the retrieval tool and not sync_documents', async () => {
  rag.setMode('ok')
  const { run } = await scripted({ toolName: 'capability_status' })
  const [trace] = toolTraces(run.events)
  assert.match(trace!.text, /Context provider "rag" is available: mcp__rag__retrieve_context\./)
  assert.doesNotMatch(trace!.text, /sync_documents/)
})
