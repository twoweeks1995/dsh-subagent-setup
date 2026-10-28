/**
 * 取 webServer 服务：ctx.get() 是主路径；某些 cordis 版本对未 inject 的服务
 * 只允许属性访问，故补一条回退（失败不算错，说明服务不存在）。
 */
export function resolveWebServer(ctx) {
  try {
    const viaGet = ctx.get('webServer')
    if (viaGet !== undefined) return viaGet
  } catch { /* 回退到属性访问 */ }
  try {
    return ctx.webServer
  } catch {
    return undefined
  }
}

/** 错误对象 → 可展示文本；非 Error 也统一转字符串。 */
export function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
