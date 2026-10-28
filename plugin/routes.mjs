/**
 * dsh-subagent-setup —— HTTP 后端路由。
 *
 * 安全边界照抄上游 dsh-subagent-model-router（lib/index.js:1752-1802）：
 *   - 仅 loopback 可访问；
 *   - PUT 需要同源浏览器请求 + application/json；
 *   - 请求体上限 256 KiB，非法 JSON 返回 400。
 *
 * 与上游的区别：DSH 依赖全部由 createSettingsRoutes / createSessionRoutes 注入
 * （readConfig / writeConfig / readCatalog / readSubagentModel / closeSubagent），
 * 因此本文件可脱离宿主直接单测；revision 是字符串（mtimeMs 或
 * 内容 sha256 前缀均可），与 DSH Settings 服务的整数 revision 不兼容也没关系。
 *
 * 写路径（读 revision → 比对 → 写入）通过 createSettingsRoutes 内部的 Promise 链串行化，
 * 避免两个并发 PUT 都读到旧 revision、双双写盘互相覆盖。
 */
import { errorMessage } from './util.mjs'

const NAMESPACE = 'subagent-setup'
const SETTINGS_PATH = '/dsh-subagent-setup/settings'
const CATALOG_PATH = '/dsh-subagent-setup/catalog'
const SUBAGENT_MODEL_PATH = '/dsh-subagent-setup/subagent-model'
const CLOSE_SUBAGENT_PATH = '/dsh-subagent-setup/close-subagent'
const BODY_LIMIT = 256 * 1024

function sendJson(res, statusCode, value) {
  const body = JSON.stringify(value)
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', String(Buffer.byteLength(body)))
  res.end(body)
}

function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function isSameOriginMutation(req) {
  const host = req.headers.host
  const origin = req.headers.origin
  if (typeof host !== 'string') return false
  let hostname
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  const loopbackHost = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
  if (typeof origin === 'string') {
    try {
      const parsed = new URL(origin)
      if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.host !== host) return false
      return loopbackHost
    } catch {
      return false
    }
  }
  return loopbackHost && req.headers['sec-fetch-site'] === 'same-origin'
}

// 只放行 application/json 本体，或其后紧跟分号参数（如 charset=utf-8）。
function isJsonContentType(value) {
  if (typeof value !== 'string') return false
  const mediaType = value.toLowerCase().split(';', 1)[0].trim()
  return mediaType === 'application/json'
}

async function readJsonBody(req) {
  req.setEncoding('utf8')
  let text = ''
  for await (const chunk of req) {
    text += chunk
    if (Buffer.byteLength(text) > BODY_LIMIT) {
      throw new Error('请求体超过 256 KiB 上限。')
    }
  }
  if (text.length === 0) throw new Error('请求体不能为空。')
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw new SyntaxError('请求体不是合法 JSON。')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('请求体必须是 JSON 对象。')
  }
  return value
}

/**
 * @param {object} deps 全部 DSH 依赖由调用方注入。
 *   readConfig()  -> { config: object, revision: string }
 *   writeConfig(config) -> { config: object, revision: string }
 *   readCatalog() -> { current?, providers: [...] }
 */
export function createSettingsRoutes({ readConfig, writeConfig, readCatalog }) {
  // 所有写路径排队执行；task 抛错会沿链传播但不会阻塞后续任务。
  let writeQueue = Promise.resolve()

  function enqueueWrite(task) {
    const run = writeQueue.then(task, task)
    writeQueue = run.then(() => undefined, () => undefined)
    return run
  }

  async function handleSettings(req, res) {
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      sendJson(res, 403, { error: '子代理模型设置仅允许通过本机回环地址访问。' })
      return
    }

    if (req.method === 'GET') {
      try {
        const { config, revision } = await readConfig()
        sendJson(res, 200, { namespace: NAMESPACE, writable: true, config, revision })
      } catch (error) {
        sendJson(res, 500, { error: `读取配置失败：${errorMessage(error)}` })
      }
      return
    }

    if (req.method !== 'PUT') {
      res.setHeader('allow', 'GET, PUT')
      sendJson(res, 405, { error: '仅支持 GET 与 PUT。' })
      return
    }

    if (!isSameOriginMutation(req)) {
      sendJson(res, 403, { error: '设置更新要求同源浏览器请求。' })
      return
    }
    if (!isJsonContentType(req.headers['content-type'])) {
      sendJson(res, 415, { error: '设置更新要求 application/json 请求体。' })
      return
    }

    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      sendJson(res, 400, { error: errorMessage(error) })
      return
    }
    if (typeof body.config !== 'object' || body.config === null || Array.isArray(body.config)) {
      sendJson(res, 400, { error: '请求体缺少 config 对象。' })
      return
    }
    if (body.expectedRevision !== undefined && typeof body.expectedRevision !== 'string') {
      sendJson(res, 400, { error: 'expectedRevision 必须是字符串。' })
      return
    }

    try {
      const result = await enqueueWrite(async () => {
        if (body.expectedRevision !== undefined) {
          let current
          try {
            current = await readConfig()
          } catch (error) {
            return { statusCode: 500, value: { error: `读取配置失败：${errorMessage(error)}` } }
          }
          if (current.revision !== body.expectedRevision) {
            return { statusCode: 409, value: { error: '配置已被其他页面修改，请刷新后重试。' } }
          }
        }
        try {
          const written = await writeConfig(body.config)
          return {
            statusCode: 200,
            value: { namespace: NAMESPACE, writable: true, config: written.config, revision: written.revision },
          }
        } catch (error) {
          return { statusCode: 400, value: { error: `保存配置失败：${errorMessage(error)}` } }
        }
      })
      sendJson(res, result.statusCode, result.value)
    } catch (error) {
      sendJson(res, 500, { error: `写入配置失败：${errorMessage(error)}` })
    }
  }

  async function handleCatalog(req, res) {
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      sendJson(res, 403, { error: '模型目录仅允许通过本机回环地址访问。' })
      return
    }
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET')
      sendJson(res, 405, { error: '目录只支持 GET。' })
      return
    }
    try {
      const catalog = await readCatalog()
      if (typeof catalog !== 'object' || catalog === null || Array.isArray(catalog)) {
        throw new Error('目录数据格式错误')
      }
      sendJson(res, 200, catalog)
    } catch (error) {
      sendJson(res, 500, { error: `读取模型目录失败：${errorMessage(error)}` })
    }
  }

  return [
    { path: SETTINGS_PATH, handler: handleSettings },
    { path: CATALOG_PATH, handler: handleCatalog },
  ]
}

/**
 * @param {object} deps 会话头部依赖，全部由调用方注入。
 *   readSubagentModel(id) -> { found, provider?, model?, alias?, reason? }
 *   closeSubagent({ parentSessionId, childSessionId }) -> { closed, reason? }
 */
export function createSessionRoutes({ readSubagentModel, closeSubagent }) {
  async function handleSubagentModel(req, res) {
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      sendJson(res, 403, { error: '子代理模型记录仅允许通过本机回环地址访问。' })
      return
    }
    if (req.method !== 'GET') {
      res.setHeader('allow', 'GET')
      sendJson(res, 405, { error: '子代理模型记录只支持 GET。' })
      return
    }
    let id
    try {
      const rawUrl = typeof req.url === 'string' ? req.url : '/'
      id = new URL(rawUrl, 'http://127.0.0.1').searchParams.get('id')
    } catch {
      id = undefined
    }
    if (typeof id !== 'string' || id.length === 0) {
      sendJson(res, 400, { error: '缺少 id 查询参数。' })
      return
    }
    if (typeof readSubagentModel !== 'function') {
      sendJson(res, 200, { found: false, reason: '模型记录读取不可用' })
      return
    }
    let value
    try {
      value = await readSubagentModel(id)
    } catch (error) {
      sendJson(res, 500, { error: `读取子代理模型记录失败：${errorMessage(error)}` })
      return
    }
    if (value !== null && typeof value === 'object'
      && value.found === true
      && typeof value.provider === 'string' && value.provider.length > 0
      && typeof value.model === 'string' && value.model.length > 0) {
      sendJson(res, 200, {
        found: true,
        provider: value.provider,
        model: value.model,
        ...(typeof value.alias === 'string' && value.alias.length > 0 ? { alias: value.alias } : {}),
        ...(typeof value.displayName === 'string' && value.displayName.length > 0 ? { displayName: value.displayName } : {}),
      })
      return
    }
    if (value !== null && typeof value === 'object'
      && value.found === false
      && typeof value.reason === 'string' && value.reason.length > 0) {
      sendJson(res, 200, { found: false, reason: value.reason })
      return
    }
    sendJson(res, 200, { found: false, reason: '该会话还没有模型请求记录' })
  }

  async function handleCloseSubagent(req, res) {
    if (!isLoopbackAddress(req.socket?.remoteAddress)) {
      sendJson(res, 403, { error: '释放子代理仅允许通过本机回环地址访问。' })
      return
    }
    if (req.method === 'GET') {
      sendJson(res, 200, { available: true })
      return
    }
    if (req.method !== 'POST') {
      res.setHeader('allow', 'GET, POST')
      sendJson(res, 405, { error: '释放子代理仅支持 GET 与 POST。' })
      return
    }
    if (!isSameOriginMutation(req)) {
      sendJson(res, 403, { error: '释放子代理要求同源浏览器请求。' })
      return
    }
    if (!isJsonContentType(req.headers['content-type'])) {
      sendJson(res, 415, { error: '释放子代理要求 application/json 请求体。' })
      return
    }
    let body
    try {
      body = await readJsonBody(req)
    } catch (error) {
      sendJson(res, 400, { error: errorMessage(error) })
      return
    }
    if (typeof body.parentSessionId !== 'string' || body.parentSessionId.length === 0) {
      sendJson(res, 400, { error: '请求体缺少非空的 parentSessionId。' })
      return
    }
    if (typeof body.childSessionId !== 'string' || body.childSessionId.length === 0) {
      sendJson(res, 400, { error: '请求体缺少非空的 childSessionId。' })
      return
    }
    if (typeof closeSubagent !== 'function') {
      sendJson(res, 200, { closed: false, reason: '释放子代理功能不可用' })
      return
    }
    let value
    try {
      value = await closeSubagent({ parentSessionId: body.parentSessionId, childSessionId: body.childSessionId })
    } catch (error) {
      sendJson(res, 200, { closed: false, reason: `释放失败：${errorMessage(error)}` })
      return
    }
    if (value !== null && typeof value === 'object' && typeof value.closed === 'boolean') {
      sendJson(res, 200, value)
      return
    }
    sendJson(res, 200, { closed: false, reason: '释放子代理失败' })
  }


  return [
    { path: SUBAGENT_MODEL_PATH, handler: handleSubagentModel },
    { path: CLOSE_SUBAGENT_PATH, handler: handleCloseSubagent },
  ]
}

