import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_SETTINGS,
  normalizeModel,
  normalizeSettings,
  routeKey,
  sameModel,
  sameSettings,
} from '../src/config.mjs'

test('空配置得到默认设置', () => {
  const s = normalizeSettings({})
  assert.equal(s.subagentProvider, 'spawn')
  assert.equal(s.maxDepth, 3)
  assert.equal(s.enableRunInBackground, true)
  assert.deepEqual(s.models, [])
})

test('undefined / null 也走默认值', () => {
  assert.deepEqual(normalizeSettings(undefined), normalizeSettings(DEFAULT_SETTINGS))
  assert.deepEqual(normalizeSettings(null), normalizeSettings(DEFAULT_SETTINGS))
})

test('showRouteDock / showCloseAction 默认 true，接受布尔值与字符串', () => {
  const defaults = normalizeSettings({})
  assert.equal(defaults.showRouteDock, true)
  assert.equal(defaults.showCloseAction, true)
  assert.equal(normalizeSettings({ showRouteDock: false }).showRouteDock, false)
  assert.equal(normalizeSettings({ showCloseAction: false }).showCloseAction, false)
  assert.equal(normalizeSettings({ showRouteDock: 'false' }).showRouteDock, false)
  assert.equal(normalizeSettings({ showCloseAction: 'true' }).showCloseAction, true)
})

test('showRouteDock / showCloseAction 非法值报中文错', () => {
  assert.throws(() => normalizeSettings({ showRouteDock: 0 }), /showRouteDock 必须是布尔值/)
  assert.throws(() => normalizeSettings({ showRouteDock: 'no' }), /showRouteDock/)
  assert.throws(() => normalizeSettings({ showCloseAction: {} }), /showCloseAction 必须是布尔值/)
})

test('sameSettings 会比较 showRouteDock 与 showCloseAction', () => {
  const base = normalizeSettings({})
  assert.equal(sameSettings(base, normalizeSettings({ showRouteDock: false })), false)
  assert.equal(sameSettings(base, normalizeSettings({ showCloseAction: false })), false)
  assert.equal(sameSettings(normalizeSettings({ showRouteDock: 'false' }), normalizeSettings({ showRouteDock: false })), true)
})

test('完整路由被保留并补齐 displayName', () => {
  const s = normalizeSettings({
    models: [{
      alias: 'deep',
      provider: 'acme',
      model: 'reasoner',
      description: '用于复杂实现',
      tags: ['deep-reasoning', 'implementation'],
      maxTokens: 8192,
      reasoningEffort: 'high',
    }],
  })
  assert.equal(s.models.length, 1)
  const m = s.models[0]
  assert.equal(m.displayName, 'deep', 'displayName 缺省时回退成 alias')
  assert.deepEqual(m.tags, ['deep-reasoning', 'implementation'])
  assert.equal(m.maxTokens, 8192)
  assert.equal(m.reasoningEffort, 'high')
})

test('未知字段被丢弃（前向兼容）', () => {
  const s = normalizeSettings({ models: [], 未来字段: 1, extra: { a: 1 } })
  assert.equal('未来字段' in s, false)
  assert.equal('extra' in s, false)
})

test('alias 非法时报错', () => {
  assert.throws(
    () => normalizeModel({ alias: 'Bad Alias', provider: 'p', model: 'm', description: 'd' }),
    /alias/,
  )
  assert.throws(
    () => normalizeModel({ alias: '-lead', provider: 'p', model: 'm', description: 'd' }),
    /alias/,
  )
})

test('必填字段缺失时报错并指出第几条', () => {
  assert.throws(
    () => normalizeSettings({ models: [{ alias: 'a', provider: 'p', model: 'm' }] }),
    /第 1 条路由：description/,
  )
  assert.throws(
    () => normalizeSettings({ models: [], subagentProvider: '' }),
    /subagentProvider/,
  )
})

test('alias 重复被拒绝，同一路由多别名被接受', () => {
  const base = { provider: 'p', model: 'm', description: 'd' }
  assert.throws(
    () => normalizeSettings({ models: [{ ...base, alias: 'a' }, { ...base, alias: 'a' }] }),
    /alias「a」重复/,
  )
  const s = normalizeSettings({ models: [{ ...base, alias: 'a' }, { ...base, alias: 'b' }] })
  assert.equal(s.models.length, 2)
  assert.deepEqual(s.models.map((m) => m.alias), ['a', 'b'])
})

test('标签必须是 lower-kebab-case 且去重', () => {
  assert.throws(
    () => normalizeModel({ alias: 'a', provider: 'p', model: 'm', description: 'd', tags: ['Bad_Tag'] }),
    /lower-kebab-case/,
  )
  const m = normalizeModel({ alias: 'a', provider: 'p', model: 'm', description: 'd', tags: ['x', 'x', 'y'] })
  assert.deepEqual(m.tags, ['x', 'y'])
})

test('maxTokens 收数字字符串，拒绝 0 与负数', () => {
  assert.equal(normalizeModel({ alias: 'a', provider: 'p', model: 'm', description: 'd', maxTokens: '1024' }).maxTokens, 1024)
  assert.throws(() => normalizeModel({ alias: 'a', provider: 'p', model: 'm', description: 'd', maxTokens: 0 }), /maxTokens/)
  assert.throws(() => normalizeModel({ alias: 'a', provider: 'p', model: 'm', description: 'd', maxTokens: -1 }), /maxTokens/)
})

test('agentPreset 保留合法值并裁掉两侧空白，空串/缺省不出现该键', () => {
  const m = normalizeModel({ alias: 'a', provider: 'p', model: 'm', description: 'd', agentPreset: '  preset-x  ' })
  assert.equal(m.agentPreset, 'preset-x')
  const empty = normalizeModel({ alias: 'a', provider: 'p', model: 'm', description: 'd', agentPreset: '' })
  assert.equal('agentPreset' in empty, false)
  const blank = normalizeModel({ alias: 'a', provider: 'p', model: 'm', description: 'd', agentPreset: '   ' })
  assert.equal('agentPreset' in blank, false)
  const missing = normalizeModel({ alias: 'a', provider: 'p', model: 'm', description: 'd' })
  assert.equal('agentPreset' in missing, false)
})

test('agentPreset 非字符串时报中文错', () => {
  assert.throws(
    () => normalizeModel({ alias: 'a', provider: 'p', model: 'm', description: 'd', agentPreset: 7 }),
    /第 1 条路由：agentPreset 必须是非空字符串/,
  )
  assert.throws(
    () => normalizeModel({ alias: 'a', provider: 'p', model: 'm', description: 'd', agentPreset: {} }),
    /agentPreset 必须是非空字符串/,
  )
})

test('sameModel 能识别 agentPreset 变化', () => {
  const base = { alias: 'a', provider: 'p', model: 'm', description: 'd' }
  const withPreset = { ...base, agentPreset: 'x' }
  const otherPreset = { ...base, agentPreset: 'y' }
  assert.equal(sameModel(withPreset, withPreset), true)
  assert.equal(sameModel(base, withPreset), false)
  assert.equal(sameModel(withPreset, otherPreset), false)
})

test('maxDepth 必须是非负整数', () => {
  assert.equal(normalizeSettings({ maxDepth: 0 }).maxDepth, 0)
  assert.throws(() => normalizeSettings({ maxDepth: -1 }), /maxDepth/)
  assert.throws(() => normalizeSettings({ maxDepth: 1.5 }), /maxDepth/)
})

test('routeKey 用不可见分隔符区分 provider 与 model', () => {
  assert.notEqual(routeKey('a', 'b'), routeKey('a b', ''))
})

test('sameSettings 忽略键顺序、识别内容变化', () => {
  const a = normalizeSettings({ models: [{ alias: 'x', provider: 'p', model: 'm', description: 'd' }] })
  const b = normalizeSettings({ models: [{ description: 'd', model: 'm', provider: 'p', alias: 'x' }] })
  assert.equal(sameSettings(a, b), true)
  const c = normalizeSettings({ models: [{ alias: 'x', provider: 'p', model: 'm', description: 'd2' }] })
  assert.equal(sameSettings(a, c), false)
})

test('listingInactivityTurns 默认 20，接受非负整数与数字字符串', () => {
  assert.equal(normalizeSettings({}).listingInactivityTurns, 20)
  assert.equal(normalizeSettings({ listingInactivityTurns: 0 }).listingInactivityTurns, 0)
  assert.equal(normalizeSettings({ listingInactivityTurns: '7' }).listingInactivityTurns, 7)
})

test('listingInactivityTurns 非法值报中文错', () => {
  assert.throws(() => normalizeSettings({ listingInactivityTurns: -1 }), /listingInactivityTurns 必须是非负整数/)
  assert.throws(() => normalizeSettings({ listingInactivityTurns: 1.5 }), /listingInactivityTurns/)
  assert.throws(() => normalizeSettings({ listingInactivityTurns: 'abc' }), /listingInactivityTurns/)
})

test('sameSettings 会比较 listingInactivityTurns', () => {
  const a = normalizeSettings({})
  const b = normalizeSettings({ listingInactivityTurns: 0 })
  assert.equal(sameSettings(a, b), false)
})
