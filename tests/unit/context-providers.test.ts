import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeContextProviders } from '../../bundles/core/src/context-providers.ts'

test('no MCP tool and no expectation yields no provider', () => {
  assert.deepEqual(summarizeContextProviders(['read', 'grep'], []), [])
})

test('an expected provider without tools is unavailable', () => {
  assert.deepEqual(summarizeContextProviders(['read'], ['rag']), [{ name: 'rag', status: 'unavailable', tools: [] }])
})

test('visible MCP tools make their provider available, expected providers first', () => {
  const summary = summarizeContextProviders(['mcp__docs__search', 'read', 'mcp__rag__retrieve_context'], ['rag'])
  assert.deepEqual(summary, [
    { name: 'rag', status: 'available', tools: ['mcp__rag__retrieve_context'] },
    { name: 'docs', status: 'available', tools: ['mcp__docs__search'] },
  ])
})

test('a tool name with a double underscore in its raw name stays with its server', () => {
  assert.deepEqual(summarizeContextProviders(['mcp__rag__get__all'], []), [{ name: 'rag', status: 'available', tools: ['mcp__rag__get__all'] }])
})
