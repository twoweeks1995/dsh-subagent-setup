/**
 * dsh-subagent-setup —— 只读可观测性：从会话事件流提取最后一条模型请求路由。
 *
 * 数据源与 director 的 remote.js:latestRequestHeaderModel 一致：
 * 会话事件流里最后一条 `request/header` 事件的
 * `event.data.header.config.{provider, model}` 就是子代理实际运行的模型。
 * assistant 消息里没有 provider/model。
 */

/**
 * 从尾部往前扫事件数组，取最后一条 `request/header` 事件里的 provider/model。
 * 任何异常输入都返回 undefined，绝不抛错。
 *
 * @param {unknown} events 会话事件数组
 * @returns {{ provider: string, model: string } | undefined}
 */
export function latestRequestHeaderRoute(events) {
  try {
    if (!Array.isArray(events)) return undefined
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event === null || typeof event !== 'object') continue
      if (event.type !== 'request/header') continue
      const config = event.data?.header?.config
      if (config === null || typeof config !== 'object') continue
      const provider = config.provider
      const model = config.model
      if (typeof provider === 'string' && provider.length > 0
        && typeof model === 'string' && model.length > 0) {
        return { provider, model }
      }
    }
    return undefined
  } catch {
    return undefined
  }
}
