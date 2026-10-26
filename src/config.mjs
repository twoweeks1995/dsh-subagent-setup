/**
 * 路由配置的归一化与校验（纯函数，不碰文件系统、不依赖 DSH）。
 *
 * 设计取舍：**校验消息用中文**。这些错误会直接显示在设置页和日志里，
 * 面向的是使用者而不是英文开发者；而工具描述等"给模型看"的文本保持英文（见 docs/DESIGN.md）。
 */

/** alias 只能用小写字母、数字、下划线、连字符，且必须以字母或数字开头。 */
export const ALIAS_RE = /^[a-z0-9][a-z0-9_-]*$/
/** 标签必须是 lower-kebab-case。 */
export const TAG_RE = /^[a-z0-9][a-z0-9-]*$/

/** 缺省设置：首次运行时即用这一份。 */
export const DEFAULT_SETTINGS = Object.freeze({
  subagentProvider: 'spawn',
  maxDepth: 3,
  enableRunInBackground: true,
  listingInactivityTurns: 20,
  showRouteDock: true,
  showCloseAction: true,
  models: [],
})

/** 路由的身份键（provider + model），用于去重与比较。 */
export function routeKey(provider, model) {
  return `${provider}\u0000${model}`
}

function requireText(value, field, where) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${where}：${field} 不能为空`)
  }
  return value.trim()
}

function requireBoolean(value, field, where) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${where}：${field} 必须是布尔值（true 或 false）`)
}

/**
 * 归一化单条路由。
 * @param {unknown} entry 原始条目
 * @param {number} index 序号（仅用于报错定位）
 */
export function normalizeModel(entry, index = 0) {
  const where = `第 ${index + 1} 条路由`
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new Error(`${where}：必须是一个对象`)
  }

  const alias = requireText(entry.alias, 'alias', where)
  if (!ALIAS_RE.test(alias)) {
    throw new Error(`${where}：alias「${alias}」只能使用小写字母、数字、下划线或连字符，且以字母或数字开头`)
  }

  const provider = requireText(entry.provider, 'provider', where)
  const model = requireText(entry.model, 'model', where)
  const description = requireText(entry.description, 'description', where)

  const displayName = entry.displayName === undefined || entry.displayName === null
    ? alias
    : requireText(entry.displayName, 'displayName', where)

  const sourceTags = entry.tags === undefined || entry.tags === null ? [] : entry.tags
  if (!Array.isArray(sourceTags)) {
    throw new Error(`${where}：tags 必须是数组`)
  }
  const tags = []
  const seen = new Set()
  for (let i = 0; i < sourceTags.length; i += 1) {
    const tag = requireText(sourceTags[i], `tags[${i}]`, where)
    if (!TAG_RE.test(tag)) {
      throw new Error(`${where}：标签「${tag}」必须是 lower-kebab-case（小写字母、数字、连字符）`)
    }
    if (seen.has(tag)) continue
    seen.add(tag)
    tags.push(tag)
  }

  let maxTokens
  if (entry.maxTokens !== undefined && entry.maxTokens !== null && entry.maxTokens !== '') {
    const n = typeof entry.maxTokens === 'string' ? Number(entry.maxTokens) : entry.maxTokens
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw new Error(`${where}：maxTokens 必须是正整数`)
    }
    maxTokens = n
  }

  let reasoningEffort
  if (entry.reasoningEffort !== undefined && entry.reasoningEffort !== null && entry.reasoningEffort !== '') {
    reasoningEffort = requireText(entry.reasoningEffort, 'reasoningEffort', where)
  }

  let agentPreset
  if (entry.agentPreset !== undefined && entry.agentPreset !== null && entry.agentPreset !== '') {
    if (typeof entry.agentPreset !== 'string') {
      throw new Error(`${where}：agentPreset 必须是非空字符串`)
    }
    const trimmed = entry.agentPreset.trim()
    if (trimmed.length > 0) agentPreset = trimmed
  }

  return {
    alias,
    provider,
    model,
    displayName,
    tags,
    description,
    ...(maxTokens === undefined ? {} : { maxTokens }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(agentPreset === undefined ? {} : { agentPreset }),
  }
}

/**
 * 归一化整份设置。未知字段直接丢弃（前向兼容：旧版本写的文件仍可读）。
 * @param {unknown} value 原始 JSON
 */
export function normalizeSettings(value) {
  if (value === undefined || value === null) return normalizeSettings(DEFAULT_SETTINGS)
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('设置必须是一个对象')
  }

  const subagentProvider = value.subagentProvider === undefined || value.subagentProvider === null
    ? DEFAULT_SETTINGS.subagentProvider
    : requireText(value.subagentProvider, 'subagentProvider', '全局设置')

  const maxDepth = value.maxDepth === undefined || value.maxDepth === null
    ? DEFAULT_SETTINGS.maxDepth
    : Number(value.maxDepth)
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) {
    throw new Error('全局设置：maxDepth 必须是非负整数')
  }

  const enableRunInBackground = value.enableRunInBackground === undefined || value.enableRunInBackground === null
    ? DEFAULT_SETTINGS.enableRunInBackground
    : Boolean(value.enableRunInBackground)

  const listingInactivityTurns = value.listingInactivityTurns === undefined || value.listingInactivityTurns === null
    ? DEFAULT_SETTINGS.listingInactivityTurns
    : Number(value.listingInactivityTurns)
  if (!Number.isSafeInteger(listingInactivityTurns) || listingInactivityTurns < 0) {
    throw new Error('全局设置：listingInactivityTurns 必须是非负整数')
  }

  const showRouteDock = value.showRouteDock === undefined || value.showRouteDock === null
    ? DEFAULT_SETTINGS.showRouteDock
    : requireBoolean(value.showRouteDock, 'showRouteDock', '全局设置')

  const showCloseAction = value.showCloseAction === undefined || value.showCloseAction === null
    ? DEFAULT_SETTINGS.showCloseAction
    : requireBoolean(value.showCloseAction, 'showCloseAction', '全局设置')

  const sourceModels = value.models === undefined || value.models === null ? [] : value.models
  if (!Array.isArray(sourceModels)) {
    throw new Error('全局设置：models 必须是数组')
  }

  const models = []
  const aliases = new Set()
  for (let i = 0; i < sourceModels.length; i += 1) {
    const model = normalizeModel(sourceModels[i], i)
    if (aliases.has(model.alias)) {
      throw new Error(`第 ${i + 1} 条路由：alias「${model.alias}」重复`)
    }
    aliases.add(model.alias)
    models.push(model)
  }

  return { subagentProvider, maxDepth, enableRunInBackground, listingInactivityTurns, showRouteDock, showCloseAction, models }
}

/** 两条路由是否完全一致（用于判断配置有没有真的变化）。 */
export function sameModel(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  const tagsA = a.tags ?? []
  const tagsB = b.tags ?? []
  return a.alias === b.alias
    && a.provider === b.provider
    && a.model === b.model
    && (a.displayName ?? a.alias) === (b.displayName ?? b.alias)
    && a.description === b.description
    && a.maxTokens === b.maxTokens
    && a.reasoningEffort === b.reasoningEffort
    && a.agentPreset === b.agentPreset
    && tagsA.length === tagsB.length
    && tagsA.every((tag, i) => tag === tagsB[i])
}

/** 整份设置是否等价（忽略键顺序）。 */
export function sameSettings(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  if (a.subagentProvider !== b.subagentProvider) return false
  if (a.maxDepth !== b.maxDepth) return false
  if (a.enableRunInBackground !== b.enableRunInBackground) return false
  if (a.listingInactivityTurns !== b.listingInactivityTurns) return false
  if (a.showRouteDock !== b.showRouteDock) return false
  if (a.showCloseAction !== b.showCloseAction) return false
  const left = a.models ?? []
  const right = b.models ?? []
  if (left.length !== right.length) return false
  return left.every((model, i) => sameModel(model, right[i]))
}
