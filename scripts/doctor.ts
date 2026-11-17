/**
 * Checks that this machine can run the distribution: Node version, the pinned
 * upstream checkout and its build, the provider key, installed profiles, and
 * the retrieval endpoint. Exits 1 when a required check fails; a missing
 * retrieval service is reported but never fails, because RAG is optional.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BASE, ROOT } from './base.ts'

interface Finding {
  name: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
}

const PINNED = readFileSync(join(ROOT, 'UPSTREAM.md'), 'utf8').match(/`([0-9a-f]{40})`/)?.[1]
const HOME = process.env.DSH_HOME ?? join(ROOT, '.dsh-home')
const findings: Finding[] = []
const add = (name: string, status: Finding['status'], detail: string): void => { findings.push({ name, status, detail }) }

const [major, minor] = process.versions.node.split('.').map(Number) as [number, number]
add('node', major > 24 || (major === 24 && minor >= 9) ? 'ok' : 'fail', `v${process.versions.node} (upstream requires >= 24.9)`)

if (!existsSync(join(BASE, 'package.json'))) {
  add('upstream checkout', 'fail', `not found at ${BASE}; set DSH_BASE`)
}
else {
  const head = spawnSync('git', ['-C', BASE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
  add('upstream commit', head === PINNED ? 'ok' : 'warn', head === PINNED ? head : `checkout is at ${head}, tests were recorded against ${PINNED}`)
  const dirty = spawnSync('git', ['-C', BASE, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim()
  add('upstream unmodified', dirty.length === 0 ? 'ok' : 'warn', dirty.length === 0 ? 'no local change' : `${dirty.split('\n').length} changed path(s)`)
  const bin = join(BASE, 'apps', 'cli', 'lib', 'bin.js')
  add('upstream build', existsSync(bin) ? 'ok' : 'fail', existsSync(bin) ? 'apps/cli/lib/bin.js present' : 'run "corepack pnpm install && corepack pnpm run build:artifacts" in the checkout')
}

const keyFiles = [join(ROOT, '.env'), join(ROOT, '..', '.env')]
const hasKey = (process.env.GEMINI_API_KEY ?? '').length > 0 || keyFiles.some(file => existsSync(file) && /^GEMINI_API_KEY=.+/m.test(readFileSync(file, 'utf8')))
add('provider key', hasKey ? 'ok' : 'warn', hasKey ? 'GEMINI_API_KEY is set' : 'GEMINI_API_KEY is missing: live runs fail, scripted tests still work')

for (const profile of ['map-core-headless', 'map-rag-headless', 'map-core', 'map-rag']) {
  const manifest = join(HOME, 'profiles', profile, 'package.json')
  add(`profile ${profile}`, existsSync(manifest) ? 'ok' : 'fail', existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).dsh.profile.bundles.join(' + ') : 'missing: run ./scripts/setup-profiles.sh')
}

const ragUrl = process.env.MAP_RAG_URL ?? 'http://127.0.0.1:8001/mcp'
try {
  const response = await fetch(ragUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    signal: AbortSignal.timeout(3000),
  })
  const tools = [...(await response.text()).matchAll(/"name":"([^"]+)"/g)].map(match => match[1])
  add('retrieval service', response.ok ? 'ok' : 'warn', response.ok ? `${ragUrl} offers: ${tools.join(', ') || 'no tool'}` : `${ragUrl} answered HTTP ${response.status}`)
}
catch (error) {
  add('retrieval service', 'warn', `${ragUrl} is unreachable (${error instanceof Error ? error.name : 'error'}): map-rag profiles start without retrieval`)
}

for (const finding of findings) console.log(`${finding.status.toUpperCase().padEnd(4)}  ${finding.name}: ${finding.detail}`)
process.exit(findings.some(finding => finding.status === 'fail') ? 1 : 0)
