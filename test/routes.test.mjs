import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createRoutes } from '../plugin/routes.mjs'
import { configPath, readSettings, writeSettings } from '../src/store.mjs'

const SETTINGS_PATH = '/dsh-subagent-setup/settings'
const CATALOG_PATH = '/dsh-subagent-setup/catalog'
const SUBAGENT_MODEL_PATH = '/dsh-subagent-setup/subagent-model'
const CLOSE_SUBAGENT_PATH = '/dsh-subagent-setup/close-subagent'
const BODY_LIMIT = 256 * 1024

function sha16(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function makeAdapters(path) {
  return {
    async readConfig() {
      const { settings, existed } = await readSettings(path)
      const revision = existed ? sha16(await readFile(path, 'utf8')) : 'default'
      return { config: settings, revision }
    },
    async writeConfig(config) {
      const settings = await writeSettings(path, config)
      const revision = sha16(await readFile(path, 'utf8'))
      return { config: settings, revision }
    },
    async readSubagentModel(id) {
      if (id === 'child-1') return { found: true, provider: 'acme', model: 'acme-fast' }
      return { found: false, reason: '会话不存在' }
    },
    async closeSubagent() {
      return { closed: true }
    },
    async readCatalog() {
      return {
        current: { provider: 'acme', model: 'reasoner' },
        providers: [
          {
            id: 'acme',
            name: 'Acme AI',
            models: [
              { id: 'reasoner', name: 'Reasoner', description: '深度推理' },
              { id: 'tiny', name: 'Tiny', inputModalities: ['text'] },
            ],
          },
          { id: 'broken', name: 'Broken AI', error: '连接超时', models: [] },
        ],
      }
    },
  }
}

function sameOriginHeaders(contentType = 'application/json') {
  return {
    host: '127.0.0.1:14910',
    origin: 'http://127.0.0.1:14910',
    'content-type': contentType,
    'sec-fetch-site': 'same-origin',
  }
}

function fakeRequest(options = {}) {
  const method = options.method ?? 'GET'
  const headers = options.headers ?? {}
  const body = options.body
  const chunks = body === undefined ? [] : [body]
  return {
    method,
    url: options.url,
    headers,
    socket: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
    setEncoding() {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function fakeResponse() {
  const response = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      response.headers[name.toLowerCase()] = value
    },
    end(text) {
      response.body = text
      return response
    },
  }
  return response
}

async function callRoute(routes, path, options = {}) {
  const route = routes.find((candidate) => candidate.path === path)
  assert.ok(route, '未注册路由 ' + path)
  const response = fakeResponse()
  const url = options.query === undefined
    ? path
    : path + '?' + options.query
  await route.handler(fakeRequest({ ...options, url }), response)
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: JSON.parse(response.body),
  }
}

function validConfig() {
  return {
    subagentProvider: 'spawn',
    maxDepth: 2,
    enableRunInBackground: false,
    models: [
      { alias: 'fast', provider: 'acme', model: 'reasoner', description: '快速任务' },
    ],
  }
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'subagent-setup-routes-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('GET /settings 返回命名空间、可写标记、归一化配置与 revision', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))
    const result = await callRoute(routes, SETTINGS_PATH)

    assert.equal(result.statusCode, 200)
    assert.equal(result.headers['content-type'], 'application/json; charset=utf-8')
    assert.equal(result.headers['cache-control'], 'no-store')
    assert.equal(result.body.namespace, 'subagent-setup')
    assert.equal(result.body.writable, true)
    assert.equal(result.body.config.subagentProvider, 'spawn')
    assert.equal(result.body.config.maxDepth, 3)
    assert.equal(result.body.config.enableRunInBackground, true)
    assert.deepEqual(result.body.config.models, [])
    assert.equal(typeof result.body.revision, 'string')
    assert.ok(result.body.revision.length > 0)
  })
})

test('PUT /settings 正常写入后 revision 变化且可读回', async () => {
  await withTempDir(async (dir) => {
    const path = configPath(dir)
    const routes = createRoutes(makeAdapters(path))

    const before = await callRoute(routes, SETTINGS_PATH)
    const result = await callRoute(routes, SETTINGS_PATH, {
      method: 'PUT',
      headers: sameOriginHeaders(),
      body: JSON.stringify({ config: validConfig(), expectedRevision: before.body.revision }),
    })

    assert.equal(result.statusCode, 200)
    assert.notEqual(result.body.revision, before.body.revision)
    assert.equal(result.body.config.models[0].alias, 'fast')

    const after = await callRoute(routes, SETTINGS_PATH)
    assert.equal(after.body.revision, result.body.revision)
    assert.equal(after.body.config.models[0].description, '快速任务')

    const { settings, existed } = await readSettings(path)
    assert.equal(existed, true)
    assert.equal(settings.models[0].alias, 'fast')
  })
})

test('PUT /settings 带旧 revision 返回 409', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const before = await callRoute(routes, SETTINGS_PATH)
    const first = await callRoute(routes, SETTINGS_PATH, {
      method: 'PUT',
      headers: sameOriginHeaders(),
      body: JSON.stringify({ config: validConfig(), expectedRevision: before.body.revision }),
    })
    assert.equal(first.statusCode, 200)

    const stale = await callRoute(routes, SETTINGS_PATH, {
      method: 'PUT',
      headers: sameOriginHeaders(),
      body: JSON.stringify({
        config: { ...validConfig(), maxDepth: 5 },
        expectedRevision: before.body.revision,
      }),
    })
    assert.equal(stale.statusCode, 409)

    const after = await callRoute(routes, SETTINGS_PATH)
    assert.equal(after.body.config.maxDepth, 2)
  })
})

test('两个并发 PUT 带同一 expectedRevision：恰好一个 200、一个 409', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const before = await callRoute(routes, SETTINGS_PATH)
    const configA = validConfig()
    const configB = {
      ...validConfig(),
      maxDepth: 5,
      models: [{ alias: 'second', provider: 'acme', model: 'tiny', description: '第二个配置' }],
    }

    const [a, b] = await Promise.all([
      callRoute(routes, SETTINGS_PATH, {
        method: 'PUT',
        headers: sameOriginHeaders(),
        body: JSON.stringify({ config: configA, expectedRevision: before.body.revision }),
      }),
      callRoute(routes, SETTINGS_PATH, {
        method: 'PUT',
        headers: sameOriginHeaders(),
        body: JSON.stringify({ config: configB, expectedRevision: before.body.revision }),
      }),
    ])

    const statuses = [a.statusCode, b.statusCode].sort((x, y) => x - y)
    assert.deepEqual(statuses, [200, 409])

    const winner = a.statusCode === 200 ? a : b
    const after = await callRoute(routes, SETTINGS_PATH)
    assert.equal(after.body.revision, winner.body.revision)
    assert.equal(after.body.config.maxDepth, winner.body.config.maxDepth)
    assert.equal(after.body.config.models[0].alias, winner.body.config.models[0].alias)
  })
})

test('PUT /settings 非法 config 返回 400 且不落盘', async () => {
  await withTempDir(async (dir) => {
    const path = configPath(dir)
    const routes = createRoutes(makeAdapters(path))

    const result = await callRoute(routes, SETTINGS_PATH, {
      method: 'PUT',
      headers: sameOriginHeaders(),
      body: JSON.stringify({
        config: {
          models: [{ alias: 'Bad Alias', provider: 'acme', model: 'reasoner', description: 'd' }],
        },
      }),
    })

    assert.equal(result.statusCode, 400)
    const { settings, existed } = await readSettings(path)
    assert.equal(existed, false)
    assert.deepEqual(settings.models, [])
  })
})

test('非 loopback 一律 403', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const settingsGet = await callRoute(routes, SETTINGS_PATH, { remoteAddress: '192.168.1.10' })
    assert.equal(settingsGet.statusCode, 403)

    const settingsPut = await callRoute(routes, SETTINGS_PATH, {
      method: 'PUT',
      remoteAddress: '192.168.1.10',
      headers: sameOriginHeaders(),
      body: JSON.stringify({ config: validConfig() }),
    })
    assert.equal(settingsPut.statusCode, 403)

    const catalogGet = await callRoute(routes, CATALOG_PATH, { remoteAddress: '192.168.1.10' })
    assert.equal(catalogGet.statusCode, 403)
  })
})

test('PUT /settings 非同源返回 403', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const evilOrigin = await callRoute(routes, SETTINGS_PATH, {
      method: 'PUT',
      headers: {
        host: '127.0.0.1:14910',
        origin: 'http://evil.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ config: validConfig() }),
    })
    assert.equal(evilOrigin.statusCode, 403)

    const missingOrigin = await callRoute(routes, SETTINGS_PATH, {
      method: 'PUT',
      headers: { host: '127.0.0.1:14910', 'content-type': 'application/json' },
      body: JSON.stringify({ config: validConfig() }),
    })
    assert.equal(missingOrigin.statusCode, 403)
  })
})

test('PUT /settings content-type 仅放行 application/json 或其后分号参数', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const plain = await callRoute(routes, SETTINGS_PATH, {
      method: 'PUT',
      headers: sameOriginHeaders('text/plain'),
      body: JSON.stringify({ config: validConfig() }),
    })
    assert.equal(plain.statusCode, 415)

    const jsonp = await callRoute(routes, SETTINGS_PATH, {
      method: 'PUT',
      headers: sameOriginHeaders('application/jsonp'),
      body: JSON.stringify({ config: validConfig() }),
    })
    assert.equal(jsonp.statusCode, 415)

    const withParams = await callRoute(routes, SETTINGS_PATH, {
      method: 'PUT',
      headers: sameOriginHeaders('application/json; charset=utf-8'),
      body: JSON.stringify({ config: validConfig() }),
    })
    assert.equal(withParams.statusCode, 200)
  })
})

test('PUT /settings 超大 body 返回 400', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const body = JSON.stringify({ config: validConfig(), padding: 'x'.repeat(BODY_LIMIT + 64) })
    assert.ok(Buffer.byteLength(body) > BODY_LIMIT)

    const result = await callRoute(routes, SETTINGS_PATH, {
      method: 'PUT',
      headers: sameOriginHeaders(),
      body,
    })
    assert.equal(result.statusCode, 400)
  })
})

test('PUT /settings 非法 JSON 返回 400', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const result = await callRoute(routes, SETTINGS_PATH, {
      method: 'PUT',
      headers: sameOriginHeaders(),
      body: '{ not json',
    })
    assert.equal(result.statusCode, 400)
  })
})

test('PUT /settings 不传 expectedRevision 时直接写入', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const result = await callRoute(routes, SETTINGS_PATH, {
      method: 'PUT',
      headers: sameOriginHeaders(),
      body: JSON.stringify({ config: validConfig() }),
    })
    assert.equal(result.statusCode, 200)
    assert.equal(result.body.config.maxDepth, 2)
  })
})

test('GET /catalog 返回目录快照', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const result = await callRoute(routes, CATALOG_PATH)
    assert.equal(result.statusCode, 200)
    assert.equal(result.body.current.provider, 'acme')
    assert.equal(result.body.providers.length, 2)
    assert.equal(result.body.providers[0].models.length, 2)
    assert.equal(result.body.providers[1].error, '连接超时')
  })
})

test('不支持的方法返回 405 并带 allow 头', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const settings = await callRoute(routes, SETTINGS_PATH, { method: 'POST' })
    assert.equal(settings.statusCode, 405)
    assert.equal(settings.headers.allow, 'GET, PUT')

    const catalog = await callRoute(routes, CATALOG_PATH, { method: 'DELETE' })
    assert.equal(catalog.statusCode, 405)
    assert.equal(catalog.headers.allow, 'GET')

    const model = await callRoute(routes, SUBAGENT_MODEL_PATH, { method: 'POST', query: 'id=child-1' })
    assert.equal(model.statusCode, 405)
    assert.equal(model.headers.allow, 'GET')
  })
})

test('GET /subagent-model 正常返回 found:true 与 provider/model', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const result = await callRoute(routes, SUBAGENT_MODEL_PATH, { query: 'id=child-1' })
    assert.equal(result.statusCode, 200)
    assert.deepEqual(result.body, { found: true, provider: 'acme', model: 'acme-fast' })
  })
})

test('GET /subagent-model 会话不存在返回 found:false', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const result = await callRoute(routes, SUBAGENT_MODEL_PATH, { query: 'id=missing' })
    assert.equal(result.statusCode, 200)
    assert.deepEqual(result.body, { found: false, reason: '会话不存在' })
  })
})

test('GET /subagent-model 缺 id 返回 400', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const noQuery = await callRoute(routes, SUBAGENT_MODEL_PATH)
    assert.equal(noQuery.statusCode, 400)

    const blank = await callRoute(routes, SUBAGENT_MODEL_PATH, { query: 'id=' })
    assert.equal(blank.statusCode, 400)
  })
})

test('GET /subagent-model 非 GET 返回 405 并带 allow 头', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const result = await callRoute(routes, SUBAGENT_MODEL_PATH, { method: 'PUT', query: 'id=child-1' })
    assert.equal(result.statusCode, 405)
    assert.equal(result.headers.allow, 'GET')
  })
})

test('GET /subagent-model 非 loopback 返回 403', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const result = await callRoute(routes, SUBAGENT_MODEL_PATH, {
      query: 'id=child-1',
      remoteAddress: '192.168.1.10',
    })
    assert.equal(result.statusCode, 403)
  })
})
test('POST /close-subagent 正常释放返回 closed:true', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const result = await callRoute(routes, CLOSE_SUBAGENT_PATH, {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({ parentSessionId: 'parent-1', childSessionId: 'child-1' }),
    })
    assert.equal(result.statusCode, 200)
    assert.deepEqual(result.body, { closed: true })
  })
})

test('POST /close-subagent 缺参数返回 400', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const noParent = await callRoute(routes, CLOSE_SUBAGENT_PATH, {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({ childSessionId: 'child-1' }),
    })
    assert.equal(noParent.statusCode, 400)

    const noChild = await callRoute(routes, CLOSE_SUBAGENT_PATH, {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({ parentSessionId: 'parent-1' }),
    })
    assert.equal(noChild.statusCode, 400)

    const blankParent = await callRoute(routes, CLOSE_SUBAGENT_PATH, {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({ parentSessionId: '', childSessionId: 'child-1' }),
    })
    assert.equal(blankParent.statusCode, 400)
  })
})

test('POST /close-subagent 非法 JSON 与超大 body 返回 400', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const invalidJson = await callRoute(routes, CLOSE_SUBAGENT_PATH, {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: '{ not json',
    })
    assert.equal(invalidJson.statusCode, 400)

    const hugeBody = JSON.stringify({ parentSessionId: 'parent-1', childSessionId: 'child-1', padding: 'x'.repeat(BODY_LIMIT + 64) })
    assert.ok(Buffer.byteLength(hugeBody) > BODY_LIMIT)
    const oversized = await callRoute(routes, CLOSE_SUBAGENT_PATH, {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: hugeBody,
    })
    assert.equal(oversized.statusCode, 400)
  })
})

test('POST /close-subagent 非 GET/POST 返回 405 并带 allow 头', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const result = await callRoute(routes, CLOSE_SUBAGENT_PATH, { method: 'DELETE' })
    assert.equal(result.statusCode, 405)
    assert.equal(result.headers.allow, 'GET, POST')
  })
})

test('POST /close-subagent 非 loopback 返回 403', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const result = await callRoute(routes, CLOSE_SUBAGENT_PATH, {
      method: 'POST',
      remoteAddress: '192.168.1.10',
      headers: sameOriginHeaders(),
      body: JSON.stringify({ parentSessionId: 'parent-1', childSessionId: 'child-1' }),
    })
    assert.equal(result.statusCode, 403)
  })
})

test('POST /close-subagent 非同源返回 403', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const evilOrigin = await callRoute(routes, CLOSE_SUBAGENT_PATH, {
      method: 'POST',
      headers: {
        host: '127.0.0.1:14910',
        origin: 'http://evil.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ parentSessionId: 'parent-1', childSessionId: 'child-1' }),
    })
    assert.equal(evilOrigin.statusCode, 403)

    const missingOrigin = await callRoute(routes, CLOSE_SUBAGENT_PATH, {
      method: 'POST',
      headers: { host: '127.0.0.1:14910', 'content-type': 'application/json' },
      body: JSON.stringify({ parentSessionId: 'parent-1', childSessionId: 'child-1' }),
    })
    assert.equal(missingOrigin.statusCode, 403)
  })
})

test('POST /close-subagent content-type 错误返回 415', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes(makeAdapters(configPath(dir)))

    const result = await callRoute(routes, CLOSE_SUBAGENT_PATH, {
      method: 'POST',
      headers: sameOriginHeaders('text/plain'),
      body: JSON.stringify({ parentSessionId: 'parent-1', childSessionId: 'child-1' }),
    })
    assert.equal(result.statusCode, 415)
  })
})

test('POST /close-subagent 注入函数返回 closed:false 时透传', async () => {
  await withTempDir(async (dir) => {
    const routes = createRoutes({
      ...makeAdapters(configPath(dir)),
      closeSubagent: async () => ({ closed: false, reason: '父会话已不在运行，无法释放（测试）' }),
    })

    const result = await callRoute(routes, CLOSE_SUBAGENT_PATH, {
      method: 'POST',
      headers: sameOriginHeaders(),
      body: JSON.stringify({ parentSessionId: 'parent-x', childSessionId: 'child-x' }),
    })
    assert.equal(result.statusCode, 200)
    assert.deepEqual(result.body, { closed: false, reason: '父会话已不在运行，无法释放（测试）' })
  })
})

