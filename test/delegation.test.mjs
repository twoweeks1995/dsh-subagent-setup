import assert from 'node:assert/strict'
import test from 'node:test'

import {
  adaptActivationResult,
  buildChildRequest,
  detectSubagentApi,
  findRoute,
  pickReasoningEffort,
  unknownAliasMessage,
} from '../src/delegation.mjs'

const routes = [
  { alias: 'fast', provider: 'acme', model: 'acme-fast', description: 'quick', maxTokens: 4096, reasoningEffort: 'low' },
  { alias: 'deep', provider: 'acme', model: 'reasoner', description: 'hard' },
]

test('findRoute 按别名找到路由，找不到返回 undefined', () => {
  assert.equal(findRoute(routes, 'fast'), routes[0])
  assert.equal(findRoute(routes, 'missing'), undefined)
})

test('unknownAliasMessage 是英文并列出可用别名', () => {
  assert.match(unknownAliasMessage('x', routes), /unknown model alias "x"/)
  assert.match(unknownAliasMessage('x', routes), /fast, deep/)
  assert.match(unknownAliasMessage('x', []), /no model routes are configured/)
})

test('pickReasoningEffort 三级：显式 > 别名默认 > undefined', () => {
  assert.equal(pickReasoningEffort('high', routes[0]), 'high')
  assert.equal(pickReasoningEffort(undefined, routes[0]), 'low')
  assert.equal(pickReasoningEffort(undefined, routes[1]), undefined)
  assert.equal(pickReasoningEffort('', routes[0]), 'low', '空白显式参数视为未提供')
  assert.equal(pickReasoningEffort('  high  ', routes[0]), 'high', '显式参数裁掉两侧空白')
})

test('buildChildRequest 构造内层 request', () => {
  const parent = { id: 'p' }
  const request = buildChildRequest({
    prompt: 'go',
    parent,
    maxDepth: 3,
    route: routes[0],
    reasoningEffort: 'high',
    api: 'activation',
  })
  assert.deepEqual(request, {
    prompt: [{ type: 'text', text: 'go' }],
    parent,
    maxDepth: 3,
    agentOptions: { provider: 'acme', model: 'acme-fast', maxTokens: 4096, reasoningEffort: 'high' },
  })
})

test('buildChildRequest 缺省 maxTokens/reasoningEffort 时不输出对应键', () => {
  const request = buildChildRequest({
    prompt: 'go',
    parent: 'p',
    maxDepth: 0,
    route: routes[1],
    reasoningEffort: undefined,
    api: 'legacy',
  })
  assert.equal('maxTokens' in request.agentOptions, false)
  assert.equal('reasoningEffort' in request.agentOptions, false)
  assert.deepEqual(request.prompt, [{ type: 'text', text: 'go' }])
})

test('buildChildRequest 在 route 带 agentPreset 时把它放进内层 request', () => {
  const route = { alias: 'preset', provider: 'acme', model: 'm', description: 'd', agentPreset: 'preset-a' }
  const request = buildChildRequest({
    prompt: 'go',
    parent: 'p',
    maxDepth: 1,
    route,
    reasoningEffort: undefined,
    api: 'activation',
  })
  assert.equal('agentPreset' in request, true)
  assert.equal(request.agentPreset, 'preset-a')
})

test('buildChildRequest 在 route 不带 agentPreset 时请求里不存在该键', () => {
  const request = buildChildRequest({
    prompt: 'go',
    parent: 'p',
    maxDepth: 1,
    route: routes[1],
    reasoningEffort: undefined,
    api: 'legacy',
  })
  assert.equal('agentPreset' in request, false)
})

test('detectSubagentApi 三个分支：activation / legacy / none', () => {
  assert.equal(detectSubagentApi({ startActivation() {}, start() {}, startContinuable() {} }), 'activation')
  assert.equal(detectSubagentApi({ start() {} }), 'legacy')
  assert.equal(detectSubagentApi({ startContinuable() {} }), 'legacy')
  assert.equal(detectSubagentApi({}), 'none')
  assert.equal(detectSubagentApi(null), 'none')
})

test('adaptActivationResult parent 返回 continuable 形状', () => {
  assert.deepEqual(
    adaptActivationResult({ childId: 'child-1' }, 'parent'),
    { kind: 'continuable', childId: 'child-1' },
  )
})

test('adaptActivationResult caller 返回 foreground 且 run.id 是字符串', () => {
  const result = Promise.resolve([])
  const dispose = () => {}
  const adapted = adaptActivationResult({ childId: 42, result, dispose }, 'caller')
  assert.equal(adapted.kind, 'foreground')
  assert.equal(typeof adapted.run.id, 'string')
  assert.equal(adapted.run.id, '42')
  assert.equal(adapted.run.result, result)
  assert.equal(adapted.run.dispose, dispose)
})
