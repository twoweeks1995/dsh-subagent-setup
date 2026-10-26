/**
 * 委派决策与请求构造（纯函数）。工具执行期错误面向模型，保持英文。
 */

/** 按别名查找已配置路由。 */
export function findRoute(models, alias) {
  return models.find((entry) => entry.alias === alias)
}

/** 未知名报错消息；带上可用别名方便模型自我纠正。 */
export function unknownAliasMessage(alias, models) {
  if (models.length === 0) {
    return `unknown model alias "${alias}": no model routes are configured`
  }
  return `unknown model alias "${alias}": available aliases are ${models.map((entry) => entry.alias).join(', ')}`
}

/** 推理档位三级优先：显式参数 > 别名默认 > undefined。空白显式参数视为未提供。 */
export function pickReasoningEffort(explicit, route) {
  if (typeof explicit === 'string' && explicit.trim().length > 0) return explicit.trim()
  if (route !== undefined && route !== null && route.reasoningEffort !== undefined) return route.reasoningEffort
  return undefined
}

/**
 * 构造交给子代理系统的内层 request。
 * api 只决定调用方如何补 label/signal；两种 API 的内层 request 形状相同。
 */
export function buildChildRequest(input) {
  const { prompt, parent, maxDepth, route, reasoningEffort, api } = input
  return {
    prompt: [{ type: 'text', text: prompt }],
    parent,
    maxDepth,
    agentOptions: {
      provider: route.provider,
      model: route.model,
      ...(route.maxTokens === undefined ? {} : { maxTokens: route.maxTokens }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    },
    ...(route.agentPreset ? { agentPreset: route.agentPreset } : {}),
  }
}

/** 探测子代理启动 API：新 activation、旧 legacy、或都没有。 */
export function detectSubagentApi(subagents) {
  if (typeof subagents !== 'object' || subagents === null) return 'none'
  if (typeof subagents.startActivation === 'function') return 'activation'
  if (typeof subagents.start === 'function' || typeof subagents.startContinuable === 'function') return 'legacy'
  return 'none'
}

/** 把 startActivation 的返回适配成两种对外形状。 */
export function adaptActivationResult(activation, delivery) {
  if (delivery === 'parent') {
    return { kind: 'continuable', childId: activation.childId ?? activation.id }
  }
  if (delivery === 'caller') {
    return {
      kind: 'foreground',
      run: {
        id: String(activation.childId ?? activation.id),
        result: activation.result,
        dispose: activation.dispose,
      },
    }
  }
  throw new Error(`adaptActivationResult: unsupported delivery ${JSON.stringify(delivery)}`)
}
