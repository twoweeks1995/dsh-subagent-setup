/**
 * 从会话记录读子代理实际运行的模型，以及释放可持续子代理。
 * 两个函数都显式接受 ctx：会话条目（读路由 / 释放）与主条目（close 工具）各自把自己的 ctx 传进来，
 * 不依赖 apply 闭包，也不依赖两条目的加载顺序。
 */
import { errorMessage } from './util.mjs'
import { latestRequestHeaderRoute } from '../src/observe.mjs'
import { readConfigView } from './config-io.mjs'

/**
 * 把 provider/model 映射回配置里的 alias 与 displayName。
 * alias 是模型写的句柄（建议取中性词），displayName 是给人看的名字——界面优先显示后者。
 */
async function withAlias(result) {
  if (result.found !== true) return result
  try {
    const view = await readConfigView()
    const models = Array.isArray(view?.config?.models) ? view.config.models : []
    const hit = models.find((m) => m.provider === result.provider && m.model === result.model)
    if (hit === undefined) return result
    const extra = {}
    if (typeof hit.alias === 'string' && hit.alias.length > 0) extra.alias = hit.alias
    if (typeof hit.displayName === 'string' && hit.displayName.length > 0) extra.displayName = hit.displayName
    return Object.keys(extra).length === 0 ? result : { ...result, ...extra }
  } catch { /* 拿不到映射不算失败 */ }
  return result
}

export async function readSubagentModel(ctx, id) {
  try {
    const sessionQuery = ctx.get('sessionQuery')
    if (sessionQuery !== undefined && typeof sessionQuery.readSession === 'function') {
      let sid = id
      try {
        const mod = await import('@deepseek-ai/dsh-session')
        if (typeof mod?.SessionId === 'function') {
          const branded = mod.SessionId(id)
          if (branded !== undefined) sid = branded
        }
      } catch { /* 解析不到就用原始字符串 */ }
      const log = await sessionQuery.readSession(sid)
      const logEvents = Array.isArray(log?.events) ? log.events : (Array.isArray(log) ? log : [])
      const logRoute = latestRequestHeaderRoute(logEvents)
      if (logRoute !== undefined) return withAlias({ found: true, provider: logRoute.provider, model: logRoute.model })
      return { found: false, reason: '该会话还没有模型请求记录' }
    }
    // 回退：仍在内存里的会话可以走活动代理注册表
    const agents = ctx.get('agents')
    const agent = typeof agents?.get === 'function' ? agents.get(id) : undefined
    if (agent === undefined) return { found: false, reason: '读不到该会话的记录（sessionQuery 不可用，活动代理注册表里也没有它）' }
    let events
    if (typeof agent.session?.snapshotEvents === 'function') events = agent.session.snapshotEvents()
    else if (Array.isArray(agent.session?.events)) events = agent.session.events
    else events = []
    const route = latestRequestHeaderRoute(events)
    if (route !== undefined) return withAlias({ found: true, provider: route.provider, model: route.model })
    return { found: false, reason: '该会话还没有模型请求记录' }
  } catch (error) {
    return { found: false, reason: `读取子代理模型记录失败：${errorMessage(error)}` }
  }
}

export async function closeSubagent(ctx, { parentSessionId, childSessionId }) {
  try {
    const agents = ctx.get('agents')
    const parent = typeof agents?.get === 'function' ? agents.get(parentSessionId) : undefined
    if (parent === undefined || parent === null) return { closed: false, reason: '父会话已不在运行，无法释放（重启或会话结束后残留的子代理只能靠模型侧工具）' }
    if (typeof ctx.subagents?.drainChildren !== 'function') return { closed: false, reason: '当前宿主没有 drainChildren 能力' }
    let sid = childSessionId
    try {
      const mod = await import('@deepseek-ai/dsh-session')
      if (typeof mod?.SessionId === 'function') {
        const b = mod.SessionId(childSessionId)
        if (b !== undefined) sid = b
      }
    } catch { /* 解析不到就用原始字符串 */ }
    await ctx.subagents.drainChildren(parent, [sid])
    return { closed: true }
  } catch (error) {
    return { closed: false, reason: '释放失败：' + errorMessage(error) }
  }
}
