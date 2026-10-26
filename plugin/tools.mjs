/**
 * 工具定义的共享部分：JSON schema、配置结果渲染、close_subagent 工具，
 * 以及 catalog / configure 两个工具工厂（主条目在 apply 里注入依赖）。
 */
import { renderCatalogResult, renderConfiguredModels } from '../src/catalog.mjs'
import { writeSettings } from '../src/store.mjs'
import { collectModelCatalog } from './catalog-runtime.mjs'
import { readConfigNow } from './config-io.mjs'
import { CATALOG_TOOL_NAME, CLOSE_SUBAGENT_TOOL_NAME, CONFIGURE_TOOL_NAME, DELEGATION_TOOL_NAME } from './constants.mjs'

export function modelRouteJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      alias: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      displayName: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      description: { type: 'string' },
      maxTokens: { type: 'integer' },
      reasoningEffort: { type: 'string' },
      agentPreset: { type: 'string' },
    },
    required: ['alias', 'provider', 'model', 'description'],
  }
}

export function settingsJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      subagentProvider: { type: 'string' },
      maxDepth: { type: 'integer' },
      enableRunInBackground: { type: 'boolean' },
      listingInactivityTurns: { type: 'integer' },
      // 设置页新增的两个展示开关：归一化与校验在 src/config.mjs（另一路负责），
      // 这里只放行字段，避免 additionalProperties:false 拒绝带这两个键的配置。
      showRouteDock: { type: 'boolean' },
      showCloseAction: { type: 'boolean' },
      models: { type: 'array', items: modelRouteJsonSchema() },
    },
    required: ['subagentProvider', 'maxDepth', 'enableRunInBackground', 'listingInactivityTurns', 'models'],
  }
}

export function renderConfigurationResult(value) {
  const settings = value.settings
  const routes = settings.models.length === 0
    ? '- No model routes configured.'
    : renderConfiguredModels(settings.models, undefined)
  return `${value.status === 'updated' ? 'Updated' : 'Current'} subagent model settings.\nTool: ${DELEGATION_TOOL_NAME}; backend: ${settings.subagentProvider}; max depth: ${settings.maxDepth}; background: ${String(settings.enableRunInBackground)}; listing inactivity turns: ${settings.listingInactivityTurns}\n${routes}`
}

export function createCatalogTool(ctx) {
  return {
    name: CATALOG_TOOL_NAME,
    description: 'List the model routes currently advertised by registered DSH providers. Use this read-only catalog while configuring model-routed subagents; catalog absence is advisory and does not prove a manually configured route is invalid.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          current: {
            type: 'object',
            additionalProperties: false,
            properties: {
              provider: { type: 'string' },
              model: { type: 'string' },
            },
            required: ['provider', 'model'],
          },
          providers: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                error: { type: 'string' },
                models: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      description: { type: 'string' },
                      inputModalities: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['id', 'name'],
                  },
                },
              },
              required: ['id', 'name', 'models'],
            },
          },
        },
        required: ['providers'],
      },
      render: (_args, value) => [{ type: 'text', text: renderCatalogResult(value) }],
    },
    isConcurrencySafe: () => true,
    execute(_args, exec) {
      return collectModelCatalog(ctx, exec)
    },
  }
}

export function createConfigureTool({ reconcile }) {
  return {
    name: CONFIGURE_TOOL_NAME,
    description: 'Read or replace only this plugin\'s subagent model settings in `<DSH_HOME>/subagent-setup/config.json`. Use action "update" only after the user directly asks for a configuration change and explicitly confirms the complete proposed model list. An update replaces the entire `models` array; other fields keep their current values when omitted. This tool cannot access any other file or plugin entry.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'update'],
          description: 'Use get to inspect current settings. Use update only after explicit user confirmation.',
        },
        models: {
          type: 'array',
          items: modelRouteJsonSchema(),
          description: 'For update, the complete replacement model list. Supply an empty array to remove every route.',
        },
        subagent_provider: {
          type: 'string',
          description: 'Optional subagent execution backend; omitted preserves the current value.',
        },
        max_depth: {
          type: 'integer',
          description: 'Optional non-negative delegation-depth limit; omitted preserves the current value.',
        },
        enable_run_in_background: {
          type: 'boolean',
          description: 'Optional durable-background setting; omitted preserves the current value.',
        },
        listing_inactivity_turns: {
          type: 'integer',
          description: 'Optional number of parent/user message turns before an uncontacted subagent is omitted from listing tools; 0 disables filtering.',
        },
        show_route_dock: {
          type: 'boolean',
          description: 'Optional whether to show the "subagent actually runs on …" route dock; omitted preserves the current value.',
        },
        show_close_action: {
          type: 'boolean',
          description: 'Optional whether to show the "terminate resident state" button; omitted preserves the current value.',
        },
      },
      required: ['action'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['current', 'updated'] },
          settings: settingsJsonSchema(),
        },
        required: ['status', 'settings'],
      },
      render: (_args, value) => [{ type: 'text', text: renderConfigurationResult(value) }],
    },
    isConcurrencySafe: (args) => args?.action === 'get',
    async execute(args) {
      if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        throw new Error(`${CONFIGURE_TOOL_NAME}: arguments must be an object`)
      }
      if (args.action !== 'get' && args.action !== 'update') {
        throw new Error(`${CONFIGURE_TOOL_NAME}: action must be "get" or "update"`)
      }
      if (args.action === 'update' && args.models === undefined) {
        throw new Error(`${CONFIGURE_TOOL_NAME}: models is required for action "update"`)
      }
      const { settings, path } = await readConfigNow()
      if (args.action === 'get') {
        return { status: 'current', settings }
      }
      const merged = {
        models: args.models,
        subagentProvider: args.subagent_provider ?? settings.subagentProvider,
        maxDepth: args.max_depth ?? settings.maxDepth,
        enableRunInBackground: args.enable_run_in_background ?? settings.enableRunInBackground,
        listingInactivityTurns: args.listing_inactivity_turns ?? settings.listingInactivityTurns,
        showRouteDock: args.show_route_dock ?? settings.showRouteDock,
        showCloseAction: args.show_close_action ?? settings.showCloseAction,
      }
      const written = await writeSettings(path, merged)
      // 自己写盘后立刻重挂：model 枚举与 systemPrompt 清单才能和刚写入的配置一致。
      await reconcile()
      return { status: 'updated', settings: written }
    },
  }
}

export function createCloseSubagentTool(ctx) {
  return {
    name: CLOSE_SUBAGENT_TOOL_NAME,
    description: 'Close/release one resident continuable subagent by its durable id: the continuation manager stops holding its AgentHandle, freeing memory and session context. The target must be a direct child of the calling agent; a non-resident or already-finished target is an accepted no-op. Pairs with send_message (continue) and interrupt_agent (stop one turn) to complete the lifecycle.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subagent_id: {
          type: 'string',
          description: 'The durable subagent id returned when the background subagent was started (continuable mode). Releases the resident child so the parent no longer holds its handle.',
        },
      },
      required: ['subagent_id'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { closed: { type: 'boolean' } },
        required: ['closed'],
      },
      render: (args) => [{ type: 'text', text: 'closed subagent ' + args?.subagent_id }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        throw new Error(CLOSE_SUBAGENT_TOOL_NAME + ': arguments must be an object')
      }
      if (typeof args.subagent_id !== 'string' || args.subagent_id.length === 0) {
        throw new Error(CLOSE_SUBAGENT_TOOL_NAME + ': subagent_id is required')
      }
      const parent = exec === undefined || exec === null ? undefined : exec.agent
      if (parent === undefined || parent === null) {
        throw new Error('close_subagent requires a calling agent')
      }
      let id = args.subagent_id
      try {
        const mod = await import('@deepseek-ai/dsh-session')
        if (typeof mod?.SessionId === 'function') {
          const branded = mod.SessionId(id)
          if (branded !== undefined) id = branded
        }
      } catch {
        // 解析不到就用原始字符串，不能因此失败
      }
      if (typeof ctx.subagents?.drainChildren !== 'function') {
        throw new Error('close_subagent: the host subagents service exposes no drainChildren')
      }
      await ctx.subagents.drainChildren(parent, [id])
      return { closed: true }
    },
  }
}
