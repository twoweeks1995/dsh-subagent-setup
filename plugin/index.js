/**
 * dsh-subagent-setup —— 主条目（宿主装配层）。
 *
 * 职责：把 src 里的纯函数接上 DSH 宿主服务，注册五个工具（subagent_route /
 * subagent_route_catalog / subagent_route_configure / subagent_route_wait /
 * close_subagent）、systemPrompt 路由清单、list_agents 过滤策略与设置技能。
 * 设置页 /settings（GET/PUT）与模型目录 /catalog 两条 HTTP 路由注册在本条目，
 * 因此 inject 含 webServer；会话头部 /subagent-model、/close-subagent 在 session.mjs。
 *
 * 为什么不做 Config 导出：配置存 <DSH_HOME>/subagent-setup/config.json，
 * 每次委派时重新读取，不经过 DSH Settings 服务，也不做热重挂。
 * 为什么工具描述对象手写：本文件不 import 任何 DSH 实体模块，
 * defineTool 的参数/输出 schema 转换与实参校验在此就地实现。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { DEFAULT_SETTINGS } from '../src/config.mjs'
import { renderConfiguredModels } from '../src/catalog.mjs'
import {
  adaptActivationResult,
  buildChildRequest,
  detectSubagentApi,
  findRoute,
  pickReasoningEffort,
  unknownAliasMessage,
} from '../src/delegation.mjs'
import { createTracker, createWaitTool } from './tracker.mjs'

import { createListingActivity } from './activity.mjs'
import { collectModelCatalog } from './catalog-runtime.mjs'
import { clearConfigChangeListener, notifyConfigChanged, readConfigNow, readConfigView, setConfigChangeListener, writeConfigView } from './config-io.mjs'
import {
  CATALOG_TOOL_NAME,
  CLOSE_SUBAGENT_TOOL_NAME,
  CONFIGURE_TOOL_NAME,
  DELEGATION_TOOL_NAME,
  MODEL_ROUTE_BASE_GUIDANCE,
  MODEL_ROUTE_WAIT_GUIDANCE,
  SECTION_NAME,
  SECTION_ORDER,
  SKILL_NAME,
  WAIT_TOOL_NAME,
} from './constants.mjs'
import { agentPresetBlockReason, capabilityKeys, settleForegroundRun } from './delegation-runtime.mjs'
import { createStartupRecorder, stackHead } from './startup-log.mjs'
import { createSettingsRoutes } from './routes.mjs'
import { createCatalogTool, createCloseSubagentTool, createConfigureTool } from './tools.mjs'
import { errorMessage } from './util.mjs'

function resolveWebServer(ctx) {
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

export const name = 'subagent-setup'
export const inject = ['tools', 'subagents', 'agents', 'systemPrompt', 'skills', 'llm', 'webServer']

export async function apply(ctx) {
  const logger = ctx.logger ?? { info() {}, warn() {}, error() {} }
  const activity = createListingActivity(ctx)
  const startup = createStartupRecorder()
  const recordStartup = (line) => { startup.record(line) }

  let snapshot = null
  let disposeDelegation
  let mountedModels = []
  let tracker
  let waitToolAvailable = false
  const registeredToolNames = []

  const unmountDelegation = () => {
    if (disposeDelegation === undefined) return
    try {
      disposeDelegation()
    } catch (error) {
      logger.warn(`[subagent-setup] subagent_route 卸载失败：${errorMessage(error)}`)
    }
    disposeDelegation = undefined
    mountedModels = []
  }

  const providerReady = (name) => {
    if (typeof ctx.subagents?.getProvider !== 'function') return true
    try {
      return ctx.subagents.getProvider(name) !== undefined
    } catch {
      return false
    }
  }

  const trackBackground = async (parent, selected, description, start) => {
    if (tracker === undefined) {
      const started = await start()
      return { childId: started.childId }
    }
    const state = tracker.begin(parent)
    try {
      const started = await start()
      tracker.track(state, started.childId, selected.alias, description)
      return { childId: started.childId }
    } finally {
      tracker.finish(parent, state)
    }
  }

  const mountDelegation = () => {
    if (disposeDelegation !== undefined) return
    if (snapshot === null) return
    const settings = snapshot.settings
    if (settings.models.length === 0) return
    if (!providerReady(settings.subagentProvider)) return

    const aliases = settings.models.map((entry) => entry.alias)
    const backgroundEnabled = settings.enableRunInBackground === true && waitToolAvailable
    const tool = {
      name: DELEGATION_TOOL_NAME,
      description: 'Delegate a self-contained task to a subagent on a configured model route. Choose `model` only from the routes listed in the `tool:subagent-route:models` system prompt section, the single source of truth for available routes and their routing roles. `description` is a short display label. A foreground run waits for the child output; a background run returns a durable subagent id immediately.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          model: {
            type: 'string',
            description: 'Configured model alias. Available aliases: ' + aliases.join(', ') + '. Choose only from the routes listed in the `tool:subagent-route:models` system prompt section.',
          },
          prompt: {
            type: 'string',
            description: 'The complete, self-contained task for the subagent. It does not share this conversation, so include everything it needs.',
          },
          description: {
            type: 'string',
            description: 'A short (3-5 word) description of the delegated task, for display.',
          },
          reasoning_effort: {
            type: 'string',
            description: 'Adapter-owned reasoning effort for the selected route, e.g. low for routine work or high for hard problems. Omit to use the alias default effort, or the model default when the alias sets none.',
          },
          ...(backgroundEnabled ? {
            run_in_background: {
              type: 'boolean',
              description: 'Whether to return a durable subagent id immediately. Defaults to true. Set false to wait for the result.',
            },
          } : {}),
        },
        required: ['model', 'prompt', 'description'],
      },
      output: {
        schema: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: { childId: { type: 'string' } },
              required: ['childId'],
            },
            { type: 'array', items: {} },
          ],
        },
        render: (_args, value) => {
          if (Array.isArray(value)) return value
          return [{ type: 'text', text: 'started subagent ' + value?.childId }]
        },
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        if (typeof args !== 'object' || args === null || Array.isArray(args)) {
          throw new Error(`${DELEGATION_TOOL_NAME}: arguments must be an object`)
        }
        if (typeof args.model !== 'string' || args.model.length === 0) {
          throw new Error(`${DELEGATION_TOOL_NAME}: model is required`)
        }
        if (typeof args.prompt !== 'string' || args.prompt.length === 0) {
          throw new Error(`${DELEGATION_TOOL_NAME}: prompt is required`)
        }
        if (typeof args.description !== 'string' || args.description.length === 0) {
          throw new Error(`${DELEGATION_TOOL_NAME}: description is required`)
        }
        if (args.reasoning_effort !== undefined && (typeof args.reasoning_effort !== 'string' || args.reasoning_effort.trim().length === 0)) {
          throw new Error(`${DELEGATION_TOOL_NAME}: reasoning_effort must be a non-empty string`)
        }
        if (args.run_in_background !== undefined && typeof args.run_in_background !== 'boolean') {
          throw new Error(`${DELEGATION_TOOL_NAME}: run_in_background must be a boolean`)
        }
        const parent = exec.agent
        if (parent === undefined) {
          throw new Error(`${DELEGATION_TOOL_NAME} requires a calling agent`)
        }

        // 每次委派重新读配置：配置生效不依赖工具重挂。
        const { settings } = await readConfigNow()
        const nextAliases = settings.models.map((entry) => entry.alias).sort().join(',')
        const currentAliases = mountedModels.map((entry) => entry.alias).sort().join(',')
        if (nextAliases !== currentAliases) void reconcile()
        const selected = findRoute(settings.models, args.model)
        if (selected === undefined) {
          throw new Error(unknownAliasMessage(args.model, settings.models))
        }
        const presetBlockReason = agentPresetBlockReason(selected, ctx.subagents, settings.subagentProvider)
        if (presetBlockReason !== undefined) throw new Error(presetBlockReason)
        const reasoningEffort = pickReasoningEffort(args.reasoning_effort, selected)
        const api = detectSubagentApi(ctx.subagents)
        if (api === 'none') {
          throw new Error(`${DELEGATION_TOOL_NAME}: the host exposes no subagent start API (startActivation, start, or startContinuable)`)
        }
        const runInBackground = settings.enableRunInBackground === true && waitToolAvailable && args.run_in_background !== false
        const request = buildChildRequest({
          prompt: args.prompt,
          parent,
          maxDepth: settings.maxDepth,
          route: selected,
          reasoningEffort,
          api,
          ...(selected.agentPreset === undefined ? {} : { agentPreset: selected.agentPreset }),
        })

        if (api === 'activation') {
          if (runInBackground) {
            return trackBackground(parent, selected, args.description, () => ctx.subagents.startActivation({
              provider: settings.subagentProvider,
              label: args.description,
              request,
              signal: exec.signal,
              delivery: 'parent',
            }))
          }
          const activation = await ctx.subagents.startActivation({
            provider: settings.subagentProvider,
            label: args.description,
            request,
            signal: exec.signal,
            delivery: 'caller',
          })
          return settleForegroundRun(adaptActivationResult(activation, 'caller').run)
        }

        // legacy：label / signal 已提升为激活参数，旧 API 要补回内层 request。
        const legacyRequest = { ...request, label: args.description, signal: exec.signal }
        if (runInBackground) {
          if (typeof ctx.subagents.startContinuable !== 'function') {
            throw new Error(`${DELEGATION_TOOL_NAME}: the legacy subagent API exposes no startContinuable for background runs`)
          }
          return trackBackground(parent, selected, args.description, () => ctx.subagents.startContinuable({
            provider: settings.subagentProvider,
            label: args.description,
            request: legacyRequest,
            signal: exec.signal,
          }))
        }
        if (typeof ctx.subagents.start !== 'function') {
          throw new Error(`${DELEGATION_TOOL_NAME}: the legacy subagent API exposes no start for foreground runs`)
        }
        const run = await ctx.subagents.start(settings.subagentProvider, legacyRequest)
        return settleForegroundRun(run)
      },
    }

    try {
      disposeDelegation = ctx.tools.register(tool)
      mountedModels = settings.models
      registeredToolNames.push(DELEGATION_TOOL_NAME)
      logger.info(`[subagent-setup] subagent_route 已注册（${mountedModels.length} 条别名：${mountedModels.map((entry) => entry.alias).join(', ')}）`)
    } catch (error) {
      logger.error(`[subagent-setup] subagent_route 注册失败：${errorMessage(error)}`)
    }
  }

  let reconcileChain = Promise.resolve()
  const reconcile = () => {
    const run = async () => {
      try {
        snapshot = await readConfigNow()
      } catch (error) {
        logger.error(`[subagent-setup] ${errorMessage(error)}`)
        return
      }
      unmountDelegation()
      mountDelegation()
    }
    reconcileChain = reconcileChain.then(run, run)
    return reconcileChain
  }

  // 设置接口写回配置后触发重挂：写盘与重挂同属本条目，模块级回调仍是最直接的连接方式。
  setConfigChangeListener(() => reconcile())

  // 先注册监听器再读配置，避免 provider 事件在首次读取完成前到达时被漏掉。
  ctx.on('subagent/provider-added', (provider) => {
    if (provider?.name === snapshot?.settings.subagentProvider) mountDelegation()
  })
  ctx.on('subagent/provider-removed', (providerName) => {
    if (providerName === snapshot?.settings.subagentProvider) unmountDelegation()
  })
  ctx.on('session/event', (session, event) => activity.observeSessionEvent(session, event))
  ctx.on('subagent/start', (info, parent) => {
    if (typeof parent?.id === 'string' && typeof info?.id === 'string') activity.markStart(parent.id, info.id)
  })
  ctx.on('session/disposed', (session) => activity.disposeSession(session))

  ctx.on('tools/execute', async function (exec, next) {
    const result = await next()
    if (exec.name !== 'list_agents') return result
    if (result.isError || !Array.isArray(result.value) || exec.agent === undefined) return result
    const settings = snapshot?.settings ?? DEFAULT_SETTINGS
    const inactivityTurns = Number(settings.listingInactivityTurns ?? DEFAULT_SETTINGS.listingInactivityTurns)
    const value = activity.filter(exec.agent, result.value, inactivityTurns)
    if (value.length === result.value.length) return result
    const tool = ctx.tools.get(exec.name, exec.agent)
    const rendered = tool?.output?.render?.(exec.arguments, value)
    return { ...result, value, content: Array.isArray(rendered) ? rendered : result.content }
  })

  ctx.systemPrompt?.section({
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: (context) => {
      if (disposeDelegation === undefined) return ''
      if (ctx.tools?.get?.(DELEGATION_TOOL_NAME, context?.scope) === undefined) return ''
      const waitGuidance = ctx.tools?.get?.(WAIT_TOOL_NAME, context?.scope) === undefined ? '' : ` ${MODEL_ROUTE_WAIT_GUIDANCE}`
      return `${MODEL_ROUTE_BASE_GUIDANCE}${waitGuidance}\n${renderConfiguredModels(mountedModels, undefined)}`
    },
  })

  if (ctx.tools?.register) {
    const disposeCatalog = ctx.tools.register(createCatalogTool(ctx))
    registeredToolNames.push(CATALOG_TOOL_NAME)
    ctx.effect(() => disposeCatalog, 'dsh-subagent-setup: catalog tool')

    const disposeConfigure = ctx.tools.register(createConfigureTool({ reconcile }))
    registeredToolNames.push(CONFIGURE_TOOL_NAME)
    ctx.effect(() => disposeConfigure, 'dsh-subagent-setup: configure tool')
  }

  try {
    tracker = createTracker(ctx, { logger })
    recordStartup('tracker: ok')
  } catch (error) {
    tracker = undefined
    recordStartup(`tracker: FAILED: ${errorMessage(error)}`)
    recordStartup(stackHead(error))
    logger.warn(`[subagent-setup] tracker 创建失败，subagent_route 已强制前台：${errorMessage(error)}`)
  }

  try {
    if (tracker === undefined) {
      recordStartup('wait tool: tracker 创建失败，跳过注册')
      waitToolAvailable = false
    } else if (typeof ctx.tools?.register !== 'function') {
      recordStartup('wait tool: ctx.tools.register 不可用，跳过注册')
      waitToolAvailable = false
    } else {
      const existing = ctx.tools.get(WAIT_TOOL_NAME)
      const alreadyExists = existing !== undefined
      recordStartup(`wait tool: ctx.tools.get => ${alreadyExists ? 'defined（已存在）' : 'undefined（未注册）'}`)
      if (alreadyExists) {
        recordStartup('wait tool: 已存在，跳过注册')
      } else {
        const disposeWait = ctx.tools.register(createWaitTool(tracker, { name: WAIT_TOOL_NAME }))
        ctx.effect(() => disposeWait, 'dsh-subagent-setup: wait tool')
        registeredToolNames.push(WAIT_TOOL_NAME)
        recordStartup('wait tool: 注册成功')
      }
      waitToolAvailable = true
    }
  } catch (error) {
    waitToolAvailable = false
    recordStartup(`wait tool: 注册失败: ${errorMessage(error)}`)
    recordStartup(stackHead(error))
    logger.warn(`[subagent-setup] subagent_route_wait 不可用，subagent_route 已强制前台：${errorMessage(error)}`)
  }

  if (ctx.tools?.register) {
    const existingClose = ctx.tools.get(CLOSE_SUBAGENT_TOOL_NAME)
    recordStartup(`close tool: ctx.tools.get => ${existingClose === undefined ? 'undefined（未注册）' : 'defined（已存在）'}`)
    if (existingClose !== undefined) {
      recordStartup('close tool: 已存在，跳过注册')
    } else {
      try {
        const disposeClose = ctx.tools.register(createCloseSubagentTool(ctx))
        ctx.effect(() => disposeClose, 'dsh-subagent-setup: close tool')
        registeredToolNames.push(CLOSE_SUBAGENT_TOOL_NAME)
        recordStartup('close tool: 注册成功')
      } catch (error) {
        recordStartup(`close tool: 注册失败: ${errorMessage(error)}`)
        recordStartup(stackHead(error))
        logger.warn(`[subagent-setup] close_subagent 注册失败：${errorMessage(error)}`)
      }
    }
  } else {
    recordStartup('close tool: ctx.tools.register 不可用，跳过注册')
  }

  const webServer = resolveWebServer(ctx)
  recordStartup(`webServer: ${webServer === undefined ? '不可用（路由将不注册）' : typeof webServer.register === 'function' ? 'ok' : '无 register()'}`)
  if (webServer?.register) {
    try {
      const routes = createSettingsRoutes({
        readConfig: readConfigView,
        writeConfig: async (config) => {
          const written = await writeConfigView(config)
          // 写盘成功后通知重挂（配置变更监听器由本条目自己注册）。
          await notifyConfigChanged()
          return written
        },
        readCatalog: () => collectModelCatalog(ctx, undefined),
      })
      const disposers = routes.map((route) => webServer.register({ kind: 'exact', path: route.path, handler: route.handler }))
      recordStartup(`http routes: 已注册 ${disposers.length} 条（${routes.map((route) => route.path).join(', ')}）`)
      ctx.effect(() => () => {
        for (const dispose of disposers) {
          try { dispose() } catch { /* 路由清理失败不拖垮插件卸载 */ }
        }
      }, 'dsh-subagent-setup: settings routes')
    } catch (error) {
      recordStartup(`http routes: FAILED: ${errorMessage(error)}`)
      recordStartup(stackHead(error))
      logger.warn(`[subagent-setup] HTTP 路由注册失败：${errorMessage(error)}`)
    }
  } else {
    recordStartup('http routes: 跳过（webServer 不可用）')
  }

  // 子会话跑完就会离开活动代理注册表，agents.get() 查不到（实测返回"会话不存在"）。
  // 正解是用 sessionQuery 从存储里读日志——director 也是这么做的（remote.js:398）。
  // 该服务不进 inject：进 inject 会让插件等它，万一某 profile 没有就永不加载；
  // 改成请求时懒查，那时所有服务早已挂载。
  try {
    const sq = ctx.get('sessionQuery')
    recordStartup(`sessionQuery: ${sq !== undefined && typeof sq.readSession === 'function' ? 'ok' : '启动时不可用（请求时会再懒查一次）'}`)
  } catch {
    recordStartup('sessionQuery: 取用抛错')
  }

  const skillUrl = new URL('../skills/subagent-route-setup/SKILL.md', import.meta.url)
  try {
    const content = await readFile(skillUrl, 'utf8')
    ctx.skills?.register({
      name: SKILL_NAME,
      description: 'Configure which existing DSH model routes an AI agent may use for model-routed subagents, and generate concise tags and routing descriptions for each choice.',
      whenToUse: 'Use when the user asks to set up, add, remove, review, or improve alternative models for subagents created by subagent_route.',
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'bundled',
      resourceBase: { kind: 'directory', path: fileURLToPath(new URL('../skills/subagent-route-setup', import.meta.url)) },
      content,
    })
  } catch (error) {
    logger.warn(`[subagent-setup] subagent-route-setup 技能注册失败：${errorMessage(error)}`)
  }

  ctx.effect(() => unmountDelegation, 'dsh-subagent-setup: delegation tool')
  ctx.effect(() => () => clearConfigChangeListener(), 'dsh-subagent-setup: config change listener')

  await reconcile()

  const diagnosticProviderName = snapshot?.settings.subagentProvider ?? DEFAULT_SETTINGS.subagentProvider
  let providerCapabilitiesLine
  try {
    const diagnosticProvider = typeof ctx.subagents?.getProvider === 'function'
      ? ctx.subagents.getProvider(diagnosticProviderName)
      : undefined
    providerCapabilitiesLine = diagnosticProvider === undefined
      ? `provider capabilities: subagentProvider=${diagnosticProviderName}; 未注册`
      : `provider capabilities: subagentProvider=${diagnosticProviderName}; keys=${capabilityKeys(diagnosticProvider).join(', ') || '(none)'}`
  } catch (error) {
    providerCapabilitiesLine = `provider capabilities: subagentProvider=${diagnosticProviderName}; 查询失败: ${errorMessage(error)}`
  }
  recordStartup(providerCapabilitiesLine)

  recordStartup(`waitToolAvailable: ${String(waitToolAvailable)}`)
  recordStartup(`registered tools: ${[...new Set(registeredToolNames)].join(', ') || '(none)'}`)

  await startup.flush()
}
