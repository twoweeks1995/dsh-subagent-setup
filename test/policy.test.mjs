import assert from 'node:assert/strict'
import test from 'node:test'

import { filterListing } from '../src/policy.mjs'

const child = (id) => ({ kind: 'child', id })

test('inactivityTurns === 0 时原样返回（同一引用）', () => {
  const entries = [child('a')]
  const ctx = { parentId: 'p', turnOf: new Map([['a', 1]]), currentTurn: 10, inactivityTurns: 0 }
  assert.equal(filterListing(entries, ctx), entries)
})

test('非 child 条目原样保留', () => {
  const diag = { kind: 'diagnostic', id: 'd', reason: 'unavailable' }
  const entries = [diag, child('a')]
  const ctx = { parentId: 'p', turnOf: new Map([['a', 10]]), currentTurn: 10, inactivityTurns: 1 }
  assert.deepEqual(filterListing(entries, ctx), entries)
})

test('窗口内的 child 保留，达到窗口边界的被剔除', () => {
  const entries = [child('recent'), child('boundary'), child('stale')]
  const ctx = {
    parentId: 'p',
    turnOf: new Map([['recent', 8], ['boundary', 7], ['stale', 5]]),
    currentTurn: 10,
    inactivityTurns: 3,
  }
  const result = filterListing(entries, ctx)
  assert.deepEqual(result.map((entry) => entry.id), ['recent'])
})

test('未知上次联系轮次的 child 必须保留', () => {
  const entries = [child('known'), child('unknown')]
  const ctx = {
    parentId: 'p',
    turnOf: new Map([['known', 99]]),
    currentTurn: 100,
    inactivityTurns: 3,
  }
  const result = filterListing(entries, ctx)
  assert.deepEqual(result.map((entry) => entry.id), ['known', 'unknown'])
})
