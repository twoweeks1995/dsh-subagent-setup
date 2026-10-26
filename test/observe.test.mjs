import assert from 'node:assert/strict'
import test from 'node:test'

import { latestRequestHeaderRoute } from '../src/observe.mjs'

function headerEvent(provider, model) {
  return {
    type: 'request/header',
    data: { header: { config: { provider, model } } },
  }
}

test('取最后一条 request/header 事件的路由', () => {
  const events = [
    { type: 'user/message', data: {} },
    headerEvent('acme', 'acme-fast'),
  ]
  assert.deepEqual(latestRequestHeaderRoute(events), { provider: 'acme', model: 'acme-fast' })
})

test('多条 request/header 时取最后一条', () => {
  const events = [
    headerEvent('acme', 'acme-old'),
    { type: 'assistant/message', data: {} },
    headerEvent('other', 'other-model'),
    headerEvent('acme', 'acme-final'),
  ]
  assert.deepEqual(latestRequestHeaderRoute(events), { provider: 'acme', model: 'acme-final' })
})

test('缺 provider 或 model 字段返回 undefined', () => {
  assert.equal(latestRequestHeaderRoute([
    { type: 'request/header', data: { header: { config: { model: 'acme-fast' } } } },
  ]), undefined)

  assert.equal(latestRequestHeaderRoute([
    { type: 'request/header', data: { header: { config: { provider: 'acme' } } } },
  ]), undefined)

  assert.equal(latestRequestHeaderRoute([
    { type: 'request/header', data: { header: { config: { provider: '', model: 'acme-fast' } } } },
  ]), undefined)

  assert.equal(latestRequestHeaderRoute([
    { type: 'request/header', data: { header: { config: { provider: 'acme', model: '' } } } },
  ]), undefined)

  assert.equal(latestRequestHeaderRoute([
    { type: 'request/header', data: { header: {} } },
  ]), undefined)

  assert.equal(latestRequestHeaderRoute([
    { type: 'request/header', data: null },
  ]), undefined)
})

test('非数组输入返回 undefined 且不抛错', () => {
  for (const value of [undefined, null, 'events', 42, {}, { length: 1 }]) {
    assert.equal(latestRequestHeaderRoute(value), undefined)
  }
})

test('事件里没有 request/header 时返回 undefined', () => {
  const events = [
    { type: 'user/message', data: {} },
    { type: 'assistant/message', data: {} },
    { type: 'request/footer', data: { header: { config: { provider: 'acme', model: 'acme-fast' } } } },
  ]
  assert.equal(latestRequestHeaderRoute(events), undefined)
})

test('数组里混入非对象元素时跳过继续扫描', () => {
  const events = [
    null,
    42,
    'event',
    headerEvent('acme', 'acme-fast'),
  ]
  assert.deepEqual(latestRequestHeaderRoute(events), { provider: 'acme', model: 'acme-fast' })
})
