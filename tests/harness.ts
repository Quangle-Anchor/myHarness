/**
 * Shared helpers for process-level tests. Every test boots the real `dsh` CLI on
 * an installed profile; only the model (scripted lane) and the retrieval service
 * (mock) are stand-ins.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BASE, DSH, ROOT } from '../scripts/base.ts'

export const HOME = process.env.DSH_HOME ?? join(ROOT, '.dsh-home')
export const FIXTURE = join(ROOT, 'evaluation', 'fixtures', 'sample-repo')
export const SCRIPTED_MODEL_OVERLAY = join(ROOT, 'tests', 'overlays', 'scripted-model.yml')

/** True when live-model tests can run. */
export const HAS_LIVE_KEY = (() => {
  if (process.env.GEMINI_API_KEY !== undefined) return process.env.GEMINI_API_KEY.length > 0
  return [join(ROOT, '.env'), join(ROOT, '..', '.env')].some(file => existsSync(file) && /^GEMINI_API_KEY=.+/m.test(readFileSync(file, 'utf8')))
})()

/** One durable session event as stored in the JSONL log. */
export interface SessionEvent {
  type: string
  seq: number
  time: number
  data: any
}

export interface AgentRun {
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  /** Durable events of the session this run wrote, without the header line. */
  events: SessionEvent[]
  sessionId: string | undefined
  durationMs: number
}

export interface RunOptions {
  profile: string
  task: string
  /** Agent workspace; the process runs with this as its working directory. */
  workspace: string
  /** Extra `--patch` overlays, applied after the profile's layers. */
  patches?: string[]
  env?: Record<string, string>
  /** Harness home; defaults to the distribution's home. */
  home?: string
  /** Arguments passed to the headless app after the launcher flags. */
  appArgs?: string[]
  timeoutMs?: number
}

/**
 * Copy the fixture repository into a fresh temporary directory.
 * @returns the real path of the copy and a remover.
 */
export function makeWorkspace(): { dir: string, remove: () => void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'map-ws-')))
  cpSync(FIXTURE, dir, { recursive: true })
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) }
}

/**
 * Read every session log whose header names a working directory.
 * @param workspace - real path of the agent workspace.
 * @param home - harness home that owns the session root.
 * @returns the sessions for that workspace, oldest first.
 */
export function readSessions(workspace: string, home: string = HOME): Array<{ id: string, events: SessionEvent[] }> {
  const root = join(home, 'sessions-plain')
  if (!existsSync(root)) return []
  const found: Array<{ id: string, createdAt: number, events: SessionEvent[] }> = []
  for (const group of readdirSync(root)) {
    for (const session of readdirSync(join(root, group))) {
      const dir = join(root, group, session)
      const file = readdirSync(dir).filter(name => name.endsWith('.jsonl')).sort().at(-1)
      if (file === undefined) continue
      const lines = readFileSync(join(dir, file), 'utf8').split('\n').filter(line => line.length > 0).map(line => JSON.parse(line))
      const header = lines[0]
      if (header?.type !== 'session' || header.cwd !== workspace) continue
      found.push({ id: header.id, createdAt: header.createdAt, events: lines.slice(1) })
    }
  }
  return found.sort((a, b) => a.createdAt - b.createdAt)
}

/**
 * Run one headless task and collect its output and session log.
 * @param options - profile, task, workspace, overlays, and environment.
 * @returns the process outcome and the durable events of the newest session in the workspace.
 */
export async function runAgent(options: RunOptions): Promise<AgentRun> {
  const args = ['--profile', options.profile, ...(options.patches ?? []).flatMap(patch => ['--patch', patch]), ...(options.appArgs ?? []), options.task]
  const started = Date.now()
  const child = spawn(DSH, args, {
    cwd: options.workspace,
    env: { ...process.env, DSH_HOME: options.home ?? HOME, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, options.timeoutMs ?? 120_000)
  const exitCode = await new Promise<number | null>((resolve) => { child.on('close', code => resolve(code)) })
  clearTimeout(timer)
  const session = readSessions(options.workspace, options.home).at(-1)
  return { exitCode, timedOut, stdout, stderr, events: session?.events ?? [], sessionId: session?.id, durationMs: Date.now() - started }
}

/** One tool call paired with its result. */
export interface ToolTrace {
  name: string
  arguments: any
  isError: boolean
  text: string
  errorCode: string | undefined
}

/**
 * Pair each logged tool call with its result.
 * @param events - durable session events.
 * @returns calls in log order; a call without a result has empty text.
 */
export function toolTraces(events: SessionEvent[]): ToolTrace[] {
  const results = new Map<string, SessionEvent>()
  for (const event of events) if (event.type === 'tool/result') results.set(event.data.message.toolCallId, event)
  return events.filter(event => event.type === 'tool/call').map((call) => {
    const result = results.get(call.data.callId)
    const message = result?.data.message
    return {
      name: call.data.name,
      arguments: JSON.parse(call.data.arguments || '{}'),
      isError: message?.isError === true,
      text: (message?.content ?? []).map((block: any) => block.text ?? '').join('\n'),
      errorCode: result?.data.error?.code,
    }
  })
}

/** Reasons recorded on `turn/end` events, in order. */
export const turnEndReasons = (events: SessionEvent[]): string[] => events.filter(event => event.type === 'turn/end').map(event => event.data.reason.kind)

export interface ScriptedModel {
  /** Environment that routes the DeepSeek adapter to the scripted server. */
  env: Record<string, string>
  /** Tool names offered to the model in its first request. */
  offeredTools: () => string[]
  /** Number of model requests received. */
  requestCount: () => number
  close: () => Promise<void>
}

/**
 * Start the upstream scripted Messages server. With `toolName`, the first request
 * answers with that tool call and later requests answer with `finalText`; without
 * it, every request answers with `finalText`.
 * @param script - the optional single tool call and the final answer text.
 * @returns routing environment, request inspection, and a closer.
 */
export async function startScriptedModel(script: { toolName?: string, toolArguments?: unknown, finalText?: string }): Promise<ScriptedModel> {
  const { startMockLlmServer } = await import(pathToFileURL(join(BASE, 'packages', 'test-support', 'llm-mock-server', 'lib', 'index.js')).href)
  const server = await startMockLlmServer({
    sequence: script.toolName === undefined ? ['success'] : ['tool_call_success', 'success'],
    repeatLast: true,
    successText: script.finalText ?? 'Done.',
    ...script.toolName === undefined ? {} : { toolName: script.toolName, toolArguments: JSON.stringify(script.toolArguments ?? {}) },
  })
  return {
    env: { DEEPSEEK_BASE_URL: `${server.baseURL}/v1`, DEEPSEEK_API_KEY: 'mock-key' },
    offeredTools: () => (server.requests[0]?.body?.tools ?? []).map((tool: any) => tool.name),
    requestCount: () => server.requests.length,
    close: () => server.close(),
  }
}

/** A loopback URL on which nothing listens. */
export const DEAD_RAG_URL = 'http://127.0.0.1:9/mcp'

/**
 * Digest every file under a directory, so a test can assert the workspace is byte-identical.
 * @param dir - directory to walk.
 * @returns a hash over relative paths and file contents in sorted order.
 */
export function treeDigest(dir: string): string {
  const hash = createHash('sha256')
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry)
      const relative = `${prefix}${entry}`
      if (statSync(path).isDirectory()) walk(path, `${relative}/`)
      else hash.update(relative).update('\0').update(readFileSync(path)).update('\0')
    }
  }
  walk(dir, '')
  return hash.digest('hex')
}
