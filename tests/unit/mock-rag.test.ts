import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rank } from '../../mock-rag/server.ts'

test('ranks the passage sharing the most query words first', () => {
  const [first] = rank('lost parcel refund ceiling', 4)
  assert.equal(first!.chunk_id, 'handbook/refunds.md:chunk-2')
})

test('a query sharing no word with the corpus retrieves nothing', () => {
  assert.deepEqual(rank('zebra quantum xylophone', 4), [])
})

test('top_k bounds the result', () => {
  assert.equal(rank('parcel working days', 1).length, 1)
})
