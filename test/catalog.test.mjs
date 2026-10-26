import assert from 'node:assert/strict'
import test from 'node:test'

import { routeKey } from '../src/config.mjs'
import { renderCatalogResult, renderConfiguredModels, renderModelRoute } from '../src/catalog.mjs'

const route = {
  alias: 'v4pro',
  provider: 'deepseek-account',
  model: 'deepseek-v4-pro',
  displayName: 'DeepSeek V4 Pro',
  tags: ['same-family', 'effort-tunable'],
  description: 'Use for …',
}

test('renderModelRoute 输出完整格式（含标签与档位）', () => {
  assert.equal(
    renderModelRoute(route, { efforts: ['off', 'low', 'high', 'max'], defaultEffort: 'high' }),
    '- v4pro: DeepSeek V4 Pro (deepseek-account/deepseek-v4-pro) [tags: same-family, effort-tunable] {efforts: off|low|high*|max} — Use for …',
  )
})

test('renderConfiguredModels 输出逐字等于契约格式', () => {
  const efforts = new Map([[routeKey('deepseek-account', 'deepseek-v4-pro'), { efforts: ['off', 'low', 'high', 'max'], defaultEffort: 'high' }]])
  assert.equal(
    renderConfiguredModels([route], efforts),
    '- v4pro: DeepSeek V4 Pro (deepseek-account/deepseek-v4-pro) [tags: same-family, effort-tunable] {efforts: off|low|high*|max} — Use for …',
  )
})

test('无标签时不输出 [tags: …] 段', () => {
  const bare = { ...route, tags: [] }
  assert.equal(
    renderModelRoute(bare, undefined),
    '- v4pro: DeepSeek V4 Pro (deepseek-account/deepseek-v4-pro) — Use for …',
  )
})

test('档位未知不输出 {…}，null 输出 {no reasoning effort}，空档位也不输出', () => {
  const bare = { ...route, tags: [] }
  assert.equal(renderModelRoute(bare, undefined).includes('{'), false)
  assert.equal(
    renderModelRoute(bare, null),
    '- v4pro: DeepSeek V4 Pro (deepseek-account/deepseek-v4-pro) {no reasoning effort} — Use for …',
  )
  assert.equal(renderModelRoute(bare, { efforts: [], defaultEffort: undefined }).includes('{'), false)
})

test('route 自带默认档位时额外输出 default effort，分号分隔', () => {
  const entry = { ...route, tags: [], reasoningEffort: 'low' }
  assert.equal(
    renderModelRoute(entry, { efforts: ['low', 'high'], defaultEffort: 'high' }),
    '- v4pro: DeepSeek V4 Pro (deepseek-account/deepseek-v4-pro) {default effort: low; efforts: low|high*} — Use for …',
  )
})

test('efforts Map 为 null 时按档位未知处理', () => {
  assert.equal(
    renderConfiguredModels([route], null),
    '- v4pro: DeepSeek V4 Pro (deepseek-account/deepseek-v4-pro) [tags: same-family, effort-tunable] — Use for …',
  )
})

test('renderCatalogResult 渲染当前路由、provider 与错误', () => {
  const text = renderCatalogResult({
    current: { provider: 'acme', model: 'current' },
    providers: [
      { id: 'acme', name: 'Acme', models: [{ id: 'fast', name: 'Fast', description: 'Quick model' }] },
      { id: 'offline', name: 'Offline', models: [], error: 'not connected' },
    ],
  })
  assert.match(text, /Current agent route: acme\/current/)
  assert.match(text, /Provider Acme \(acme\)/)
  assert.match(text, /  - Fast \(fast\) — Quick model/)
  assert.match(text, /Provider Offline \(offline\)/)
  assert.match(text, /  Catalog unavailable: not connected/)
})

test('renderCatalogResult 空 provider 列表给出兜底文案', () => {
  assert.equal(renderCatalogResult({ providers: [] }), 'No registered model providers were found.')
})
