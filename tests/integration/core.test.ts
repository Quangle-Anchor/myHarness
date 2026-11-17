/**
 * Core-only distribution, keyless: the real CLI and profile with a scripted model.
 * Covers T01, T02, T03, T12, and T13 of the V1 test plan.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import { test } from 'node:test'
import { ROOT } from '../../scripts/base.ts'
import { makeWorkspace, runAgent, SCRIPTED_MODEL_OVERLAY, startScriptedModel, toolTraces, treeDigest, turnEndReasons } from '../harness.ts'

const PROFILE = 'map-core-headless'

test('T01 core-only boots without the retrieval service and offers the distribution tool set', async () => {
  const model = await startScriptedModel({ finalText: 'ready' })
  const ws = makeWorkspace()
  try {
    const run = await runAgent({ profile: PROFILE, task: 'say ready', workspace: ws.dir, patches: [SCRIPTED_MODEL_OVERLAY], env: model.env })
    assert.equal(run.exitCode, 0, run.stderr)
    assert.equal(run.stdout.trim(), 'ready')
    const offered = model.offeredTools()
    for (const expected of ['read', 'grep', 'glob', 'capability_status']) assert.ok(offered.includes(expected), `${expected} is offered`)
    assert.deepEqual(offered.filter(name => name.startsWith('mcp__')), [], 'no MCP tool without the RAG bundle')
    for (const absent of ['web_fetch', 'web_search', 'subagent', 'subagent_fork', 'workflow', 'create_goal']) assert.ok(!offered.includes(absent), `${absent} is not offered`)
  }
  finally {
    ws.remove()
    await model.close()
  }
})

test('T01 fresh sessions record the read-only preset', async () => {
  const model = await startScriptedModel({ finalText: 'ok' })
  const ws = makeWorkspace()
  try {
    const run = await runAgent({ profile: PROFILE, task: 'hello', workspace: ws.dir, patches: [SCRIPTED_MODEL_OVERLAY], env: model.env })
    const preset = run.events.find(event => event.type === 'permission/preset')
    const sandbox = run.events.find(event => event.type === 'sandbox/mode')
    assert.equal(preset?.data.preset, 'read-only')
    assert.equal(sandbox?.data.mode, 'read-only')
  }
  finally {
    ws.remove()
    await model.close()
  }
})

test('T02 a search tool call runs in the workspace and its result is logged', async () => {
  const model = await startScriptedModel({ toolName: 'grep', toolArguments: { pattern: 'MAX_PARCEL_WEIGHT_KG' }, finalText: 'found' })
  const ws = makeWorkspace()
  try {
    const run = await runAgent({ profile: PROFILE, task: 'find the weight limit', workspace: ws.dir, patches: [SCRIPTED_MODEL_OVERLAY], env: model.env })
    assert.equal(run.exitCode, 0, run.stderr)
    const [trace] = toolTraces(run.events)
    assert.equal(trace?.name, 'grep')
    assert.equal(trace?.isError, false)
    assert.match(trace!.text, /src\/orders\/store\.js/)
    assert.deepEqual(turnEndReasons(run.events), ['completed'])
  }
  finally {
    ws.remove()
    await model.close()
  }
})

test('T03 a missing provider key fails with a named error instead of hanging', async () => {
  const ws = makeWorkspace()
  try {
    const run = await runAgent({ profile: PROFILE, task: 'hello', workspace: ws.dir, env: { GEMINI_API_KEY: '' }, timeoutMs: 60_000 })
    assert.equal(run.timedOut, false)
    assert.equal(run.exitCode, 1)
    assert.match(run.stderr, /MISSING_CREDENTIAL|GEMINI_API_KEY|credential/i)
  }
  finally {
    ws.remove()
  }
})

test('T12 a write under the read-only default is refused and the workspace is unchanged', async () => {
  const model = await startScriptedModel({ toolName: 'write', toolArguments: { file_path: 'NOTES.txt', content: 'hello' } })
  const ws = makeWorkspace()
  try {
    const before = treeDigest(ws.dir)
    const run = await runAgent({ profile: PROFILE, task: 'write a note', workspace: ws.dir, patches: [SCRIPTED_MODEL_OVERLAY], env: model.env })
    assert.equal(run.exitCode, 0, run.stderr)
    const [trace] = toolTraces(run.events)
    assert.equal(trace?.name, 'write')
    assert.equal(trace?.isError, true)
    assert.equal(existsSync(join(ws.dir, 'NOTES.txt')), false)
    assert.equal(treeDigest(ws.dir), before)
  }
  finally {
    ws.remove()
    await model.close()
  }
})

test('T12 a shell redirect under the read-only default writes nothing', async () => {
  const model = await startScriptedModel({ toolName: 'bash', toolArguments: { command: 'echo hello > NOTES.txt; rm -f docs/operations.md', description: 'write and delete' } })
  const ws = makeWorkspace()
  try {
    const before = treeDigest(ws.dir)
    const run = await runAgent({ profile: PROFILE, task: 'write a note', workspace: ws.dir, patches: [SCRIPTED_MODEL_OVERLAY], env: model.env })
    assert.equal(run.exitCode, 0, run.stderr)
    assert.equal(toolTraces(run.events)[0]?.name, 'bash')
    assert.equal(treeDigest(ws.dir), before)
  }
  finally {
    ws.remove()
    await model.close()
  }
})

test('T12 an explicit sandbox escalation request is asked, then refused without an approver', async () => {
  const model = await startScriptedModel({ toolName: 'write', toolArguments: { file_path: 'NOTES.txt', content: 'hello', sandbox_permissions: 'workspace-write', justification: 'The user asked for a note.' } })
  const ws = makeWorkspace()
  try {
    const run = await runAgent({ profile: PROFILE, task: 'write a note', workspace: ws.dir, patches: [SCRIPTED_MODEL_OVERLAY], env: model.env })
    const [trace] = toolTraces(run.events)
    assert.equal(trace?.isError, true)
    assert.equal(trace?.errorCode, 'SANDBOX_ESCALATION_UNAVAILABLE')
    assert.equal(run.events.filter(event => event.type === 'approval/asked').length, 1)
    assert.equal(run.events.find(event => event.type === 'approval/decided')?.data.outcome, 'unavailable')
    assert.equal(existsSync(join(ws.dir, 'NOTES.txt')), false)
  }
  finally {
    ws.remove()
    await model.close()
  }
})

test('T12 workspace-write allows a file inside the workspace and refuses one outside it', async () => {
  // The sandbox also allows backend-defined temp areas, so the outside target must not be a temp path.
  const outsideDir = join(ROOT, 'tests', '.escape-target')
  mkdirSync(outsideDir, { recursive: true })
  const ws = makeWorkspace()
  const outside = join(outsideDir, `${basename(ws.dir)}.txt`)
  const inside = await startScriptedModel({ toolName: 'write', toolArguments: { file_path: 'NOTES.txt', content: 'hello' } })
  const escape = await startScriptedModel({ toolName: 'write', toolArguments: { file_path: outside, content: 'escaped' } })
  try {
    const allowed = await runAgent({ profile: PROFILE, task: 'write a note', workspace: ws.dir, patches: [SCRIPTED_MODEL_OVERLAY], env: inside.env, appArgs: ['--permission-mode', 'workspace-write'] })
    assert.equal(toolTraces(allowed.events)[0]?.isError, false, toolTraces(allowed.events)[0]?.text)
    assert.equal(readFileSync(join(ws.dir, 'NOTES.txt'), 'utf8'), 'hello')

    const refused = await runAgent({ profile: PROFILE, task: 'write outside', workspace: ws.dir, patches: [SCRIPTED_MODEL_OVERLAY], env: escape.env, appArgs: ['--permission-mode', 'workspace-write'] })
    assert.equal(toolTraces(refused.events)[0]?.name, 'write')
    assert.equal(toolTraces(refused.events)[0]?.isError, true)
    assert.equal(existsSync(outside), false)
  }
  finally {
    rmSync(outsideDir, { recursive: true, force: true })
    ws.remove()
    await inside.close()
    await escape.close()
  }
})

test('T13 resuming a session appends a turn and does not run earlier tool calls again', async () => {
  const first = await startScriptedModel({ toolName: 'grep', toolArguments: { pattern: 'SESSION_TTL_SECONDS' }, finalText: 'first answer' })
  const second = await startScriptedModel({ finalText: 'second answer' })
  const ws = makeWorkspace()
  try {
    const run1 = await runAgent({ profile: PROFILE, task: 'find the ttl', workspace: ws.dir, patches: [SCRIPTED_MODEL_OVERLAY], env: first.env })
    assert.equal(run1.exitCode, 0, run1.stderr)
    assert.ok(run1.sessionId)
    const run2 = await runAgent({ profile: PROFILE, task: 'thanks', workspace: ws.dir, patches: [SCRIPTED_MODEL_OVERLAY], env: second.env, appArgs: ['--session-id', run1.sessionId!] })
    assert.equal(run2.exitCode, 0, run2.stderr)
    assert.equal(run2.stdout.trim(), 'second answer')
    assert.equal(run2.sessionId, run1.sessionId)
    assert.deepEqual(turnEndReasons(run2.events), ['completed', 'completed'])
    assert.equal(toolTraces(run2.events).length, 1, 'the earlier tool call is history, not re-executed')
    assert.deepEqual(run2.events.slice(0, run1.events.length).map(event => event.seq), run1.events.map(event => event.seq), 'earlier events are unchanged')
  }
  finally {
    ws.remove()
    await first.close()
    await second.close()
  }
})
