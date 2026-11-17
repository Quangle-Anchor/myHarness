// Prints the tool calls and results of the newest session log under a harness home.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
const home = process.argv[2]
const sessions = []
for (const ws of readdirSync(join(home, 'sessions-plain'))) for (const s of readdirSync(join(home, 'sessions-plain', ws))) {
  const dir = join(home, 'sessions-plain', ws, s); sessions.push([statSync(dir).mtimeMs, dir])
}
const dir = sessions.sort((a, b) => b[0] - a[0])[0][1]
const file = readdirSync(dir).find(f => f.endsWith('.jsonl'))
const events = readFileSync(join(dir, file), 'utf8').trim().split('\n').map(l => JSON.parse(l))
const width = Number(process.argv[3] ?? 300)
for (const e of events) {
  if (e.type === 'tool/call') console.log('CALL  ', e.data.name, e.data.arguments.slice(0, 160))
  if (e.type === 'tool/result') console.log('RESULT', 'isError=' + e.data.message.isError, JSON.stringify(e.data.message.content.map(c => c.text ?? c.type).join(' ')).slice(0, width), e.data.message.error ? JSON.stringify(e.data.message.error) : '')
  if (e.type === 'turn/end') console.log('TURN END', JSON.stringify(e.data.reason))
}
