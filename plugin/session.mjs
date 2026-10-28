/**
 * dsh-subagent-setup —— 会话侧条目。
 *
 * 分工：**主+设置条目给模型和设置页用，本条目给会话头部两个组件用。**
 *   - 主+设置条目：五个工具、系统提示路由清单、技能、tracker，以及 /settings、/catalog 两条 HTTP 路由。
 *   - 本条目：/subagent-model（路由提示取数）、/close-subagent（释放子代理 + GET 可用性探针）。
 * 客户端那半（client.js）是包级界面画布，不属于任何条目，数据分别走两个条目。
 *
 * 为什么拆：停用本条目时，会话头部胶囊与终止按钮拿不到接口数据、静默消失，
 * 设置页（主+设置条目）完全不受影响。
 */
import { errorMessage, resolveWebServer } from './util.mjs'
import { createStartupRecorder, stackHead } from './startup-log.mjs'
import { closeSubagent, readSubagentModel } from './session-observe.mjs'
import { createSessionRoutes } from './routes.mjs'

export const name = 'subagent-setup-session'
export const inject = ['webServer', 'subagents', 'agents', 'llm']

export async function apply(ctx) {
  const logger = ctx.logger ?? { info() {}, warn() {}, error() {} }
  const startup = createStartupRecorder()
  const recordStartup = (line) => { startup.record(line) }

  const webServer = resolveWebServer(ctx)
  recordStartup(`webServer: ${webServer === undefined ? '不可用（路由将不注册）' : typeof webServer.register === 'function' ? 'ok' : '无 register()'}`)
  if (webServer?.register) {
    try {
      const routes = createSessionRoutes({
        readSubagentModel: (id) => readSubagentModel(ctx, id),
        closeSubagent: (args) => closeSubagent(ctx, args),
      })
      const disposers = routes.map((route) => webServer.register({ kind: 'exact', path: route.path, handler: route.handler }))
      recordStartup(`http routes: 已注册 ${disposers.length} 条（${routes.map((route) => route.path).join(', ')}）`)
      ctx.effect(() => () => {
        for (const dispose of disposers) {
          try { dispose() } catch { /* 路由清理失败不拖垮插件卸载 */ }
        }
      }, 'dsh-subagent-setup: session routes')
    } catch (error) {
      recordStartup(`http routes: FAILED: ${errorMessage(error)}`)
      recordStartup(stackHead(error))
      logger.warn(`[subagent-setup] HTTP 路由注册失败：${errorMessage(error)}`)
    }
  } else {
    recordStartup('http routes: 跳过（webServer 不可用）')
  }

  await startup.flush()
}
