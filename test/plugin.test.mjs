import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeSettings } from '../src/store.mjs'

const plugin = await import('../plugin/index.js')
const session = await import('../plugin/session.mjs')

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url))

const FAST = {
  alias: 'fast',
  provider: 'acme',
  model: 'acme-fast',
  displayName: 'Fast',
  description: 'Use for quick mechanical work',
  reasoningEffort: 'low',
}

const PRESET_ROUTE = {
  alias: 'preset',
  provider: 'acme',
  model: 'acme-preset',
  displayName: 'Preset',
  description: 'Use with an agent preset',
  agentPreset: 'my-preset',
}

function makeSignal() {
  return { aborted: false }
}

// 宿主的 systemPrompt.section 只接受字符串 text；清单变化时会重新注册，
// 所以测试每次都要取**最后一个**同名段，而不是 find 到的第一个。
const sectionOf = (ctx) => {
  const list = ctx.state.sections.filter((entry) => entry.name === 'tool:subagent-route:models')
  return list[list.length - 1]
}
const sectionText = (ctx) => {
  const section = sectionOf(ctx)
  if (section === undefined) return undefined
  return typeof section.text === 'function' ? section.text({ scope: makeParent() }) : section.text
}

function makeParent(turns = 0) {
  const events = Array.from({ length: turns }, () => ({ type: 'user/message', data: { source: { kind: 'user' } } }))
  return {
    id: 'parent-1',
    session: { header: { id: 'parent-1' }, snapshotEvents: () => events },
  }
}

function makeCtx(options = {}) {
  const state = {
    handlers: new Map(),
    tools: new Map(),
    effects: [],
    sections: [],
    skills: [],
    agents: new Map(),
  }
  const ctx = {
    logger: options.logger ?? { info() {}, warn() {}, error() {} },
    tools: {
      register(tool) {
        if (options.failWaitRegistration && tool.name === 'subagent_route_wait') {
          throw new Error('wait registration failed (injected)')
        }
        state.tools.set(tool.name, tool)
        return () => { state.tools.delete(tool.name) }
      },
      get(name) { return state.tools.get(name) },
    },
    subagents: options.subagents ?? {},
    on(name, handler) {
      if (!state.handlers.has(name)) state.handlers.set(name, [])
      state.handlers.get(name).push(handler)
      return ctx
    },
    emit(name, ...args) {
      for (const handler of state.handlers.get(name) ?? []) void handler(...args)
    },
    effect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') state.effects.push(cleanup)
      return () => {}
    },
    get(name) {
      if (name === 'agents') {
        return Object.prototype.hasOwnProperty.call(options, 'agents')
          ? options.agents
          : { get: (id) => state.agents.get(id) }
      }
      if (name === 'webServer') return options.webServer
      return options.services?.[name]
    },
    systemPrompt: { section(section) { state.sections.push(section) } },
    skills: { register(skill) { state.skills.push(skill) } },
    llm: options.llm ?? { listProviders: () => [], listModels: async () => [] },
    state,
  }
  return ctx
}

function activationSubagents(overrides = {}) {
  const calls = []
  const subagents = {
    getProvider(name) { return overrides.providers?.[name] ?? { name } },
    async startActivation(spec) {
      calls.push(spec)
      return overrides.activation ?? { childId: 'child-1' }
    },
  }
  return { subagents, calls }
}

function legacySubagents(overrides = {}) {
  const calls = { start: [], startContinuable: [] }
  const subagents = {
    getProvider(name) { return overrides.providers?.[name] ?? { name } },
    async start(provider, request) {
      calls.start.push({ provider, request })
      return overrides.run ?? {
        result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'legacy ok' }] }),
        dispose: async () => {},
      }
    },
    async startContinuable(spec) {
      calls.startContinuable.push(spec)
      return { childId: 'legacy-child' }
    },
  }
  return { subagents, calls }
}

function makeWebServer() {
  const routes = []
  return {
    routes,
    register(route) {
      routes.push(route)
      return () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  }
}

async function putSettings(webServer, config) {
  const route = webServer.routes.find((entry) => entry.path === '/dsh-subagent-setup/settings')
  assert.ok(route, 'settings route registered')
  const req = {
    socket: { remoteAddress: '127.0.0.1' },
    method: 'PUT',
    headers: {
      host: '127.0.0.1:14910',
      origin: 'http://127.0.0.1:14910',
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
    },
    setEncoding() {},
    async *[Symbol.asyncIterator]() {
      yield JSON.stringify({ config })
    },
  }
  let body = ''
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(chunk) { body = chunk },
  }
  await route.handler(req, res)
  return { statusCode: res.statusCode, body: body.length === 0 ? null : JSON.parse(body) }
}
async function callCloseSubagentRoute(webServer, body) {
  const route = webServer.routes.find((entry) => entry.path === '/dsh-subagent-setup/close-subagent')
  assert.ok(route, 'close-subagent route registered')
  const req = {
    socket: { remoteAddress: '127.0.0.1' },
    method: 'POST',
    headers: {
      host: '127.0.0.1:14910',
      origin: 'http://127.0.0.1:14910',
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
    },
    setEncoding() {},
    async *[Symbol.asyncIterator]() {
      yield JSON.stringify(body)
    },
  }
  let text = ''
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(chunk) { text = chunk },
  }
  await route.handler(req, res)
  return { statusCode: res.statusCode, body: text.length === 0 ? null : JSON.parse(text) }
}

async function withConfig(t, settings) {
  const previous = process.env.DSH_HOME
  await mkdir(TEST_DIR, { recursive: true })
  const dir = await mkdtemp(join(TEST_DIR, '.tmp-'))
  process.env.DSH_HOME = dir
  const path = join(dir, 'subagent-setup', 'config.json')
  await writeSettings(path, settings)
  t.after(async () => {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(dir, { recursive: true, force: true })
  })
  return dir
}

test('导出 name / inject / apply', () => {
  assert.equal(plugin.name, 'subagent-setup')
  assert.deepEqual(plugin.inject, ['tools', 'subagents', 'agents', 'systemPrompt', 'skills', 'llm', 'webServer'])
  assert.ok(plugin.inject.includes('webServer'), '主条目 inject 必须包含 webServer')
  assert.equal(typeof plugin.apply, 'function')
  assert.equal(session.name, 'subagent-setup-session')
  assert.ok(session.inject.includes('webServer'), '会话条目 inject 必须包含 webServer')
})

test('activation 后台：startActivation 实参形状正确并返回 childId', async (t) => {
  await withConfig(t, { models: [FAST] })
  const { subagents, calls } = activationSubagents()
  const ctx = makeCtx({ subagents })
  await plugin.apply(ctx)

  const tool = ctx.tools.get('subagent_route')
  assert.ok(tool)
  assert.ok('run_in_background' in tool.parameters.properties)

  const waitTool = ctx.tools.get('subagent_route_wait')
  assert.ok(waitTool, 'wait 工具应注册成功')
  assert.deepEqual(waitTool.parameters, { type: 'object', additionalProperties: false, properties: {} })

  const parent = makeParent()
  const signal = makeSignal()
  const result = await tool.execute(
    { model: 'fast', prompt: 'go', description: 'test job', run_in_background: true },
    { agent: parent, signal },
  )
  assert.deepEqual(result, { childId: 'child-1' })
  assert.equal(calls.length, 1)
  const spec = calls[0]
  assert.equal(spec.provider, 'spawn')
  assert.equal(spec.label, 'test job')
  assert.equal(spec.delivery, 'parent')
  assert.equal(spec.signal, signal)
  assert.deepEqual(spec.request.prompt, [{ type: 'text', text: 'go' }])
  assert.equal(spec.request.parent, parent)
  assert.equal(spec.request.maxDepth, 3)
  assert.deepEqual(spec.request.agentOptions, { provider: 'acme', model: 'acme-fast', reasoningEffort: 'low' })
  assert.ok(!('label' in spec.request), 'activation request 不得含 label')
  assert.ok(!('signal' in spec.request), 'activation request 不得含 signal')
})

test('activation 前台：delivery=caller，显式 reasoning_effort 覆盖别名默认，output 原样返回', async (t) => {
  await withConfig(t, { models: [FAST] })
  const output = [{ type: 'text', text: 'done' }]
  const activation = {
    childId: 'child-2',
    result: Promise.resolve({ stopReason: 'completed', output }),
    dispose: async () => {},
  }
  const { subagents, calls } = activationSubagents({ activation })
  const ctx = makeCtx({ subagents })
  await plugin.apply(ctx)

  const tool = ctx.tools.get('subagent_route')
  const result = await tool.execute(
    { model: 'fast', prompt: 'go', description: 'test job', run_in_background: false, reasoning_effort: 'high' },
    { agent: makeParent(), signal: makeSignal() },
  )
  assert.equal(result, output, '前台 output 必须原样返回')
  assert.equal(calls.length, 1)
  const spec = calls[0]
  assert.equal(spec.delivery, 'caller')
  assert.equal(spec.request.agentOptions.reasoningEffort, 'high')
  assert.ok(!('label' in spec.request), 'activation request 不得含 label')
  assert.ok(!('signal' in spec.request), 'activation request 不得含 signal')
})

test('前台 result reject 时 dispose 恰好调用一次并抛出原错', async (t) => {
  await withConfig(t, { models: [FAST] })
  const boom = new Error('boom result')
  const rejected = Promise.reject(boom)
  rejected.catch(() => {})
  let disposeCalls = 0
  const activation = {
    childId: 'child-3',
    result: rejected,
    dispose: async () => { disposeCalls += 1 },
  }
  const { subagents, calls } = activationSubagents({ activation })
  const ctx = makeCtx({ subagents })
  await plugin.apply(ctx)

  const tool = ctx.tools.get('subagent_route')
  await assert.rejects(
    tool.execute(
      { model: 'fast', prompt: 'go', description: 'fg fail', run_in_background: false },
      { agent: makeParent(), signal: makeSignal() },
    ),
    (error) => error === boom,
  )
  assert.equal(disposeCalls, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].delivery, 'caller')
})

test('tracker/wait 不可用时强制前台且不暴露 run_in_background', async (t) => {
  await withConfig(t, { models: [FAST] })
  const output = [{ type: 'text', text: 'forced fg' }]
  const activation = {
    childId: 'child-fg',
    result: Promise.resolve({ stopReason: 'completed', output }),
    dispose: async () => {},
  }
  const { subagents, calls } = activationSubagents({ activation })
  const ctx = makeCtx({ subagents, failWaitRegistration: true })
  await plugin.apply(ctx)

  const tool = ctx.tools.get('subagent_route')
  assert.ok(tool)
  assert.ok(!('run_in_background' in tool.parameters.properties), 'wait 不可用时不得暴露 run_in_background')
  assert.equal(ctx.tools.get('subagent_route_wait'), undefined, 'wait 注册抛错后不得残留 wait 工具')

  const result = await tool.execute(
    { model: 'fast', prompt: 'go', description: 'forced fg', run_in_background: true },
    { agent: makeParent(), signal: makeSignal() },
  )
  assert.equal(result, output)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].delivery, 'caller')

  const text = sectionText(ctx)
  assert.ok(!text.includes('subagent_route_wait'), 'wait 不可用时提示不得指向不存在的工具')
  assert.ok(text.includes('- fast: Fast (acme/acme-fast)'), '路由清单照常保留')
})

test('legacy 后台：label/signal 补进 request 后调 startContinuable', async (t) => {
  await withConfig(t, { models: [FAST] })
  const { subagents, calls } = legacySubagents()
  const ctx = makeCtx({ subagents })
  await plugin.apply(ctx)

  const tool = ctx.tools.get('subagent_route')
  const signal = makeSignal()
  const result = await tool.execute(
    { model: 'fast', prompt: 'go', description: 'legacy job', run_in_background: true },
    { agent: makeParent(), signal },
  )
  assert.deepEqual(result, { childId: 'legacy-child' })
  assert.equal(calls.start.length, 0)
  assert.equal(calls.startContinuable.length, 1)
  const spec = calls.startContinuable[0]
  assert.equal(spec.provider, 'spawn')
  assert.equal(spec.label, 'legacy job')
  assert.equal(spec.signal, signal)
  assert.equal(spec.request.label, 'legacy job')
  assert.equal(spec.request.signal, signal)
  assert.deepEqual(spec.request.prompt, [{ type: 'text', text: 'go' }])
  assert.deepEqual(spec.request.agentOptions, { provider: 'acme', model: 'acme-fast', reasoningEffort: 'low' })
})

test('legacy 前台：调 start(provider, request)，request 含 label/signal', async (t) => {
  await withConfig(t, { models: [FAST] })
  const output = [{ type: 'text', text: 'legacy ok' }]
  const { subagents, calls } = legacySubagents({
    run: { result: Promise.resolve({ stopReason: 'completed', output }), dispose: async () => {} },
  })
  const ctx = makeCtx({ subagents })
  await plugin.apply(ctx)

  const tool = ctx.tools.get('subagent_route')
  const signal = makeSignal()
  const result = await tool.execute(
    { model: 'fast', prompt: 'go', description: 'legacy fg', run_in_background: false },
    { agent: makeParent(), signal },
  )
  assert.equal(result, output)
  assert.equal(calls.start.length, 1)
  assert.equal(calls.startContinuable.length, 0)
  const { provider, request } = calls.start[0]
  assert.equal(provider, 'spawn')
  assert.equal(request.label, 'legacy fg')
  assert.equal(request.signal, signal)
  assert.deepEqual(request.agentOptions, { provider: 'acme', model: 'acme-fast', reasoningEffort: 'low' })
})

test('未知别名报英文错并列出可用别名', async (t) => {
  await withConfig(t, { models: [FAST] })
  const ctx = makeCtx({ subagents: activationSubagents().subagents })
  await plugin.apply(ctx)

  const tool = ctx.tools.get('subagent_route')
  await assert.rejects(
    tool.execute({ model: 'nope', prompt: 'go', description: 'x' }, { agent: makeParent(), signal: makeSignal() }),
    (error) => {
      assert.match(error.message, /unknown model alias "nope"/)
      assert.match(error.message, /available aliases are fast/)
      return true
    },
  )
})

test('models 为空时不注册委派工具，但目录/配置工具仍在', async (t) => {
  await withConfig(t, { models: [] })
  const ctx = makeCtx({ subagents: activationSubagents().subagents })
  await plugin.apply(ctx)

  assert.equal(ctx.tools.get('subagent_route'), undefined)
  assert.ok(ctx.tools.get('subagent_route_catalog'))
  assert.ok(ctx.tools.get('subagent_route_configure'))
})

test('委派工具未挂载时 systemPrompt 文本为空串', async (t) => {
  await withConfig(t, { models: [] })
  const ctx = makeCtx({ subagents: activationSubagents().subagents })
  await plugin.apply(ctx)

  const section = sectionOf(ctx)
  assert.ok(section)
  assert.equal(section.order, 116.25)
  assert.equal(sectionText(ctx), '')
})

test('委派工具挂载时 systemPrompt 文本含指引与路由清单', async (t) => {
  await withConfig(t, { models: [FAST] })
  const ctx = makeCtx({ subagents: activationSubagents().subagents })
  await plugin.apply(ctx)

  const text = sectionText(ctx)
  assert.match(text, /subagent_route_wait/)
  assert.ok(text.includes('- fast: Fast (acme/acme-fast)'))
})

test('configure：get 返回当前设置，update 整份替换 models 并保留其余字段', async (t) => {
  const dir = await withConfig(t, {
    subagentProvider: 'spawn',
    maxDepth: 4,
    enableRunInBackground: false,
    listingInactivityTurns: 7,
    models: [FAST],
  })
  const ctx = makeCtx({ subagents: activationSubagents().subagents })
  await plugin.apply(ctx)

  const configure = ctx.tools.get('subagent_route_configure')
  const current = await configure.execute({ action: 'get' }, {})
  assert.equal(current.status, 'current')
  assert.equal(current.settings.models.length, 1)
  assert.equal(current.settings.maxDepth, 4)

  const DEEP = {
    alias: 'deep',
    provider: 'acme',
    model: 'acme-deep',
    displayName: 'Deep',
    tags: ['deep-reasoning'],
    description: 'Use for hard reasoning',
  }
  const updated = await configure.execute({ action: 'update', models: [DEEP] }, {})
  assert.equal(updated.status, 'updated')
  assert.equal(updated.settings.models.length, 1)
  assert.equal(updated.settings.models[0].alias, 'deep')
  assert.equal(updated.settings.subagentProvider, 'spawn')
  assert.equal(updated.settings.maxDepth, 4)
  assert.equal(updated.settings.enableRunInBackground, false)
  assert.equal(updated.settings.listingInactivityTurns, 7)

  const saved = JSON.parse(await readFile(join(dir, 'subagent-setup', 'config.json'), 'utf8'))
  assert.equal(saved.models[0].alias, 'deep')
  assert.equal(saved.maxDepth, 4)

  const delegation = ctx.tools.get('subagent_route')
  assert.ok(delegation, 'configure update 后委派工具按新配置重挂')
  assert.ok(!('enum' in delegation.parameters.properties.model), 'model 参数不得有静态 enum')
  assert.ok(delegation.parameters.properties.model.description.includes('deep'))
  assert.ok(!('run_in_background' in delegation.parameters.properties))
})

test('设置页 PUT 保存新别名后，systemPrompt 与 subagent_route 立即生效', async (t) => {
  await withConfig(t, { models: [FAST] })
  const webServer = makeWebServer()
  const { subagents, calls } = activationSubagents()
  const ctx = makeCtx({ subagents, webServer })
  await plugin.apply(ctx)

  const SLOW = {
    alias: 'slow',
    provider: 'acme',
    model: 'acme-slow',
    displayName: 'Slow',
    description: 'Use for careful review',
  }
  const { statusCode } = await putSettings(webServer, {
    subagentProvider: 'spawn',
    maxDepth: 3,
    enableRunInBackground: true,
    listingInactivityTurns: 20,
    models: [FAST, SLOW],
  })
  assert.equal(statusCode, 200)

  assert.ok(sectionText(ctx).includes('slow'), 'PUT 后 systemPrompt 立即包含新别名')

  const tool = ctx.tools.get('subagent_route')
  assert.ok(tool.parameters.properties.model.description.includes('slow'))
  const result = await tool.execute(
    { model: 'slow', prompt: 'go', description: 'slow job', run_in_background: true },
    { agent: makeParent(), signal: makeSignal() },
  )
  assert.deepEqual(result, { childId: 'child-1' })
  assert.equal(calls[0].request.agentOptions.model, 'acme-slow')
})

test('人工直接改 config.json 后，新别名无需重启即可委派（enum 已移除）', async (t) => {
  const dir = await withConfig(t, { models: [FAST] })
  const { subagents, calls } = activationSubagents()
  const ctx = makeCtx({ subagents })
  await plugin.apply(ctx)

  const tool = ctx.tools.get('subagent_route')
  assert.ok(!('enum' in tool.parameters.properties.model), 'model 参数不得再有静态 enum')

  const SLOW = {
    alias: 'slow',
    provider: 'acme',
    model: 'acme-slow',
    displayName: 'Slow',
    description: 'Use for careful review',
  }
  await writeSettings(join(dir, 'subagent-setup', 'config.json'), { models: [FAST, SLOW] })

  const result = await tool.execute(
    { model: 'slow', prompt: 'go', description: 'slow job', run_in_background: true },
    { agent: makeParent(), signal: makeSignal() },
  )
  assert.deepEqual(result, { childId: 'child-1' })
  assert.equal(calls[0].request.agentOptions.model, 'acme-slow')

  await assert.rejects(
    tool.execute({ model: 'nope', prompt: 'go', description: 'x' }, { agent: makeParent(), signal: makeSignal() }),
    (error) => {
      assert.match(error.message, /unknown model alias "nope"/)
      assert.match(error.message, /fast, slow/)
      return true
    },
  )

  for (let i = 0; i < 20; i += 1) {
    if (sectionText(ctx).includes('slow')) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.ok(sectionText(ctx).includes('slow'), '委派后 reconcile 追上人工编辑的新别名')
})

test('委派时配置读取失败给出含路径的中文错误', async (t) => {
  const dir = await withConfig(t, { models: [FAST] })
  const ctx = makeCtx({ subagents: activationSubagents().subagents })
  await plugin.apply(ctx)

  const tool = ctx.tools.get('subagent_route')
  await writeFile(join(dir, 'subagent-setup', 'config.json'), '{broken', 'utf8')
  await assert.rejects(
    tool.execute({ model: 'fast', prompt: 'go', description: 'x' }, { agent: makeParent(), signal: makeSignal() }),
    /读取子代理路由配置失败/,
  )
})

test('catalog：单个 provider 失败只降级该项并渲染错误', async (t) => {
  await withConfig(t, { models: [] })
  const ctx = makeCtx({
    llm: {
      listProviders: () => [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
      listModels: async (id) => {
        if (id === 'p1') return [{ id: 'm1', name: 'M1' }]
        throw new Error('boom')
      },
    },
  })
  await plugin.apply(ctx)

  const tool = ctx.tools.get('subagent_route_catalog')
  const value = await tool.execute({}, {})
  assert.equal(value.providers.length, 2)
  assert.equal(value.providers[0].error, undefined)
  assert.equal(value.providers[0].models[0].id, 'm1')
  assert.equal(value.providers[1].error, 'boom')
  const rendered = tool.output.render({}, value)
  assert.ok(rendered[0].text.includes('Provider P1 (p1)'))
  assert.match(rendered[0].text, /Catalog unavailable: boom/)
})

test('list_agents 输出按 listingInactivityTurns 过滤', async (t) => {
  await withConfig(t, { models: [FAST], listingInactivityTurns: 2 })
  const ctx = makeCtx({ subagents: activationSubagents().subagents })
  await plugin.apply(ctx)

  const parent = makeParent(0)
  ctx.emit('subagent/start', { id: 'known-old' }, parent)
  for (let i = 0; i < 5; i += 1) {
    ctx.emit('session/event', parent.session, { type: 'user/message', data: { source: { kind: 'user' } } })
  }

  const entries = [
    { kind: 'child', id: 'known-old', label: 'old', status: 'inactive' },
    { kind: 'child', id: 'unknown', label: 'unknown', status: 'inactive' },
  ]
  const handler = ctx.state.handlers.get('tools/execute')[0]
  const result = await handler(
    { name: 'list_agents', agent: parent, arguments: { scope: 'children' } },
    async () => ({ isError: false, value: entries, content: [{ type: 'text', text: 'all' }] }),
  )
  assert.deepEqual(result.value, [
    { kind: 'child', id: 'unknown', label: 'unknown', status: 'inactive' },
  ])
})

test('close 工具在名字被占用时跳过注册', async (t) => {
  await withConfig(t, { models: [] })
  const ctx = makeCtx({ subagents: {} })
  const occupant = { name: 'close_subagent', marker: 'director' }
  ctx.state.tools.set('close_subagent', occupant)
  await plugin.apply(ctx)

  assert.equal(ctx.tools.get('close_subagent'), occupant)
})

test('close 工具空闲时注册并调用 drainChildren 释放子代理', async (t) => {
  await withConfig(t, { models: [] })
  const drained = []
  const subagents = {
    getProvider: (name) => ({ name }),
    drainChildren: async (parent, ids) => { drained.push({ parent, ids }) },
  }
  const ctx = makeCtx({ subagents })
  await plugin.apply(ctx)

  const tool = ctx.tools.get('close_subagent')
  assert.ok(tool, 'close_subagent 应注册成功')
  assert.equal(tool.name, 'close_subagent')
  assert.equal(tool.parameters.properties.subagent_id.type, 'string')
  assert.ok(tool.parameters.required.includes('subagent_id'))
  assert.deepEqual(tool.output.schema.properties.closed, { type: 'boolean' })
  assert.equal(tool.output.render({ subagent_id: 'child-9' }, { closed: true })[0].text, 'closed subagent child-9')
  assert.equal(tool.isConcurrencySafe(), true)

  const parent = makeParent()
  const result = await tool.execute({ subagent_id: 'child-7' }, { agent: parent })
  assert.deepEqual(result, { closed: true })
  assert.equal(drained.length, 1)
  assert.equal(drained[0].parent, parent)
  assert.deepEqual(drained[0].ids, ['child-7'])

  await assert.rejects(
    tool.execute({ subagent_id: 'child-8' }, {}),
    /close_subagent requires a calling agent/,
  )
})

test('带 agentPreset 且 provider 无能力：委派抛英文错且不启动', async (t) => {
  await withConfig(t, { models: [PRESET_ROUTE] })
  const { subagents, calls } = activationSubagents()
  const ctx = makeCtx({ subagents })
  await plugin.apply(ctx)

  const tool = ctx.tools.get('subagent_route')
  await assert.rejects(
    tool.execute({ model: 'preset', prompt: 'go', description: 'x' }, { agent: makeParent(), signal: makeSignal() }),
    (error) => {
      assert.match(error.message, /Agent Preset "my-preset"/)
      assert.match(error.message, /does not support independent preset selection/)
      assert.match(error.message, /non-inheriting subagent provider|drop the route's agentPreset/)
      return true
    },
  )
  assert.equal(calls.length, 0)
})

test('带 agentPreset 且 provider 有能力：实参 request 含 agentPreset', async (t) => {
  await withConfig(t, { models: [PRESET_ROUTE] })
  const { subagents, calls } = activationSubagents({
    providers: {
      spawn: { name: 'spawn', capabilities: { agentPreset: true } },
    },
  })
  const ctx = makeCtx({ subagents })
  await plugin.apply(ctx)

  const tool = ctx.tools.get('subagent_route')
  const result = await tool.execute(
    { model: 'preset', prompt: 'go', description: 'preset job', run_in_background: true },
    { agent: makeParent(), signal: makeSignal() },
  )
  assert.deepEqual(result, { childId: 'child-1' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].request.agentPreset, 'my-preset')
})

test('无 agentPreset 的路由：request 不出现 agentPreset 键', async (t) => {
  await withConfig(t, { models: [FAST] })
  const { subagents, calls } = activationSubagents()
  const ctx = makeCtx({ subagents })
  await plugin.apply(ctx)

  const tool = ctx.tools.get('subagent_route')
  await tool.execute(
    { model: 'fast', prompt: 'go', description: 'no preset', run_in_background: true },
    { agent: makeParent(), signal: makeSignal() },
  )
  assert.equal(calls.length, 1)
  assert.ok(!('agentPreset' in calls[0].request))
})

async function callSubagentModelRoute(webServer, query) {
  const route = webServer.routes.find((entry) => entry.path === '/dsh-subagent-setup/subagent-model')
  assert.ok(route, 'subagent-model route registered')
  const req = {
    method: 'GET',
    url: query === undefined ? route.path : route.path + '?' + query,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    setEncoding() {},
    async *[Symbol.asyncIterator]() {},
  }
  let body = ''
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(chunk) { body = chunk },
  }
  await route.handler(req, res)
  return { statusCode: res.statusCode, body: body.length === 0 ? null : JSON.parse(body) }
}

test('HTTP /subagent-model：createRoutes 注入项包含 readSubagentModel 并读取最后一条 request/header', async (t) => {
  await withConfig(t, { models: [] })
  const webServer = makeWebServer()
  const ctx = makeCtx({ webServer })
  ctx.state.agents.set('child-1', {
    session: {
      snapshotEvents: () => [
        { type: 'user/message', data: {} },
        { type: 'request/header', data: { header: { config: { provider: 'acme', model: 'acme-first' } } } },
        { type: 'request/header', data: { header: { config: { provider: 'acme', model: 'acme-final' } } } },
      ],
    },
  })
  await session.apply(ctx)

  const result = await callSubagentModelRoute(webServer, 'id=child-1')
  assert.equal(result.statusCode, 200)
  assert.deepEqual(result.body, { found: true, provider: 'acme', model: 'acme-final' })
})

test('readSubagentModel：agents 服务缺失时返回 found:false 而不是抛错', async (t) => {
  await withConfig(t, { models: [] })
  const webServer = makeWebServer()
  const ctx = makeCtx({ webServer, agents: undefined })
  await session.apply(ctx)

  const result = await callSubagentModelRoute(webServer, 'id=child-1')
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.found, false)
  assert.equal(typeof result.body.reason, 'string')
})

test('readSubagentModel：会话缺失时返回 found:false 而不是抛错', async (t) => {
  await withConfig(t, { models: [] })
  const webServer = makeWebServer()
  const ctx = makeCtx({ webServer })
  await session.apply(ctx)

  const result = await callSubagentModelRoute(webServer, 'id=missing')
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.found, false)
  assert.equal(typeof result.body.reason, 'string')
  assert.ok(result.body.reason.length > 0)
})

test('readSubagentModel：snapshotEvents 抛错时返回 found:false 而不是 HTTP 500', async (t) => {
  await withConfig(t, { models: [] })
  const webServer = makeWebServer()
  const ctx = makeCtx({ webServer })
  ctx.state.agents.set('child-1', {
    session: {
      snapshotEvents() {
        throw new Error('boom')
      },
    },
  })
  await session.apply(ctx)

  const result = await callSubagentModelRoute(webServer, 'id=child-1')
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.found, false)
  assert.match(result.body.reason, /读取子代理模型记录失败/)
})
test('HTTP /close-subagent：父会话不存在时返回 closed:false 且不抛错', async (t) => {
  await withConfig(t, { models: [] })
  const webServer = makeWebServer()
  const ctx = makeCtx({ webServer })
  await session.apply(ctx)

  const result = await callCloseSubagentRoute(webServer, { parentSessionId: 'missing-parent', childSessionId: 'child-1' })
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.closed, false)
  assert.match(result.body.reason, /父会话已不在运行/)
})

test('HTTP /close-subagent：drainChildren 抛错时返回 closed:false', async (t) => {
  await withConfig(t, { models: [] })
  const webServer = makeWebServer()
  const subagents = {
    getProvider: (name) => ({ name }),
    drainChildren: async () => { throw new Error('drain boom') },
  }
  const ctx = makeCtx({ webServer, subagents })
  ctx.state.agents.set('parent-1', makeParent())
  await session.apply(ctx)

  const result = await callCloseSubagentRoute(webServer, { parentSessionId: 'parent-1', childSessionId: 'child-1' })
  assert.equal(result.statusCode, 200)
  assert.equal(result.body.closed, false)
  assert.match(result.body.reason, /释放失败：drain boom/)
})

test('GET /close-subagent 探针返回 available:true', async (t) => {
  await withConfig(t, { models: [] })
  const webServer = makeWebServer()
  const ctx = makeCtx({ webServer })
  await session.apply(ctx)

  const route = webServer.routes.find((entry) => entry.path === '/dsh-subagent-setup/close-subagent')
  assert.ok(route, 'close-subagent route registered')
  const req = {
    method: 'GET',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    setEncoding() {},
    async *[Symbol.asyncIterator]() {},
  }
  let body = ''
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(chunk) { body = chunk },
  }
  await route.handler(req, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(body), { available: true })
})
test('client.js 可通过 new Function 解析', async () => {
  const source = await readFile(fileURLToPath(new URL('../plugin/client.js', import.meta.url)), 'utf8')
  assert.doesNotThrow(() => { new Function(source) })
})

