/**
 * The evaluation runner on its keyless scripted engine. Covers T14 of the V1 test plan:
 * the same input yields the same scored report, with versions and a trace per run.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { evaluate } from '../../evaluation/runner/cli.ts'
import { stableView } from '../../evaluation/runner/report.ts'
import type { EvalMode } from '../../evaluation/runner/types.ts'

const MODES: EvalMode[] = ['core-only', 'rag-on', 'rag-offline']

test('T14 two scripted evaluations produce the same scored report with versions and traces', async () => {
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'map-eval-')))
  try {
    const first = await evaluate({ engine: 'scripted', modes: MODES, concurrency: 4, requestsPerMinute: 0, resume: false, outDir: join(out, 'a') })
    const second = await evaluate({ engine: 'scripted', modes: MODES, concurrency: 4, requestsPerMinute: 0, resume: false, outDir: join(out, 'b') })
    assert.deepEqual(stableView(first), stableView(second))

    assert.match(first.meta.upstreamCommit, /^[0-9a-f]{40}$/)
    assert.ok(first.meta.upstreamVersion.length > 0)
    assert.deepEqual(Object.keys(first.meta.bundles), ['map-core', 'map-rag'])

    for (const result of first.results) {
      assert.ok(result.traceFile, `${result.caseId} ${result.mode} has a trace`)
      assert.ok(existsSync(join(out, 'a', result.traceFile!)))
    }
    for (const file of ['report.json', 'report.csv', 'report.md']) assert.ok(existsSync(join(out, 'a', file)), file)
    assert.equal(readFileSync(join(out, 'a', 'report.csv'), 'utf8').trim().split('\n').length, first.results.length + 1)
  }
  finally {
    rmSync(out, { recursive: true, force: true })
  }
})

test('T14 the scorer separates supported answers from unsupported ones', async () => {
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'map-eval-')))
  try {
    const report = await evaluate({ engine: 'scripted', modes: MODES, concurrency: 4, requestsPerMinute: 0, resume: false, outDir: out })
    const outcome = (caseId: string, mode: EvalMode): boolean => report.results.find(result => result.caseId === caseId && result.mode === mode)!.success

    // The same cited answer is supported only where the session actually retrieved the source.
    assert.equal(outcome('s-context-cited', 'rag-on'), true)
    assert.equal(outcome('s-context-cited', 'core-only'), false)
    assert.equal(outcome('s-context-cited', 'rag-offline'), false)
    // A citation without any retrieval is fabricated in every mode.
    for (const mode of MODES) assert.equal(outcome('s-negative-fabricated-citation', mode), false)
    // Refused actions with an honest answer succeed in every mode.
    for (const caseId of ['s-core-search', 's-core-no-tool', 's-negative-sync', 's-negative-write']) {
      for (const mode of MODES) assert.equal(outcome(caseId, mode), true, `${caseId} ${mode}`)
    }
    const ragOn = report.summary.find(item => item.mode === 'rag-on')!
    assert.equal(ragOn.fabricatedCitations, 1)
    assert.equal(ragOn.timeouts, 0)
  }
  finally {
    rmSync(out, { recursive: true, force: true })
  }
})
