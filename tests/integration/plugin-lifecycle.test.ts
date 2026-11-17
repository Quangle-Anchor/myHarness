/**
 * Installing and removing the distribution bundles through `dsh plugin`.
 * Covers T04 and T05 of the V1 test plan on a scratch profile.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { BASE, DSH, ROOT } from '../../scripts/base.ts'
import { makeWorkspace, runAgent, SCRIPTED_MODEL_OVERLAY, startScriptedModel } from '../harness.ts'

const PROFILE = 'map-lifecycle-test'
// A scratch home: the bare upstream template writes compressed logs, which cannot share a session root with the distribution's plain logs.
const HOME = realpathSync(mkdtempSync(join(tmpdir(), 'map-home-')))
const dsh = (...args: string[]) => spawnSync(DSH, args, { encoding: 'utf8', env: { ...process.env, DSH_HOME: HOME } })

async function offeredTools(): Promise<string[]> {
  const model = await startScriptedModel({})
  const ws = makeWorkspace()
  try {
    const run = await runAgent({ profile: PROFILE, home: HOME, task: 'hello', workspace: ws.dir, patches: [SCRIPTED_MODEL_OVERLAY], env: { ...model.env, MAP_RAG_URL: 'http://127.0.0.1:9/mcp' } })
    assert.equal(run.exitCode, 0, run.stderr)
    return model.offeredTools()
  }
  finally {
    ws.remove()
    await model.close()
  }
}

after(() => rmSync(HOME, { recursive: true, force: true }))

test('T04/T05 a bundle adds its tool when installed and removes it when uninstalled', async () => {
  assert.equal(dsh('--profile', PROFILE, '--from-default-profile', 'headless', '--dump-config').status, 0)
  assert.ok(!(await offeredTools()).includes('capability_status'), 'the upstream template has no distribution tool')

  assert.equal(dsh('plugin', '--profile', PROFILE, 'add', join(ROOT, 'bundles', 'core')).status, 0)
  const installed = dsh('--profile', PROFILE, '--dump-config')
  assert.match(installed.stdout, /map-core\/capability-status/)
  assert.ok((await offeredTools()).includes('capability_status'))

  assert.equal(dsh('plugin', '--profile', PROFILE, 'remove', 'map-core').status, 0)
  const removed = dsh('--profile', PROFILE, '--dump-config')
  assert.doesNotMatch(removed.stdout, /map-core/)
  const offered = await offeredTools()
  assert.ok(!offered.includes('capability_status'))
  assert.ok(offered.includes('read'), 'the rest of the agent still works')
})

test('the upstream checkout has no local modification', () => {
  const status = spawnSync('git', ['-C', BASE, 'status', '--porcelain'], { encoding: 'utf8' })
  assert.equal(status.status, 0)
  assert.equal(status.stdout, '')
})
