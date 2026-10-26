/**
 * 委派执行期共用的纯运行函数（不依赖 apply 闭包）。
 */
import { DELEGATION_TOOL_NAME } from './constants.mjs'

export function stopReasonError(result) {
  switch (result?.stopReason) {
    case 'completed': return undefined
    case 'aborted': return 'subagent run was cancelled'
    case 'error': return 'subagent run failed'
    case 'max-tokens': return 'subagent run hit its token limit before finishing'
    case 'refusal': return 'subagent declined the task'
    default: return `subagent run ended abnormally (${String(result?.stopReason)})`
  }
}

export function withPartialText(error, output) {
  const text = Array.isArray(output)
    ? output.filter((block) => block?.type === 'text').map((block) => block.text).join('')
    : ''
  return text.length === 0 ? error : `${error}\nPartial output before the run ended:\n${text}`
}

/** 前台运行：等 result → 检查 stopReason → dispose → 原样返回 output。 */
export async function settleForegroundRun(run) {
  let result
  let resultError
  let disposeFailure
  try {
    result = await run.result
  } catch (error) {
    resultError = error
  } finally {
    try {
      if (typeof run.dispose === 'function') await run.dispose()
    } catch (error) {
      disposeFailure = error
    }
  }
  if (resultError !== undefined) {
    if (disposeFailure !== undefined) {
      throw new AggregateError(
        [resultError, disposeFailure],
        `subagent run failed: ${String(resultError)}; dispose failed: ${String(disposeFailure)}`,
      )
    }
    throw resultError
  }
  const failure = stopReasonError(result)
  if (failure !== undefined) throw new Error(withPartialText(failure, result?.output))
  if (disposeFailure !== undefined) throw disposeFailure
  return result?.output
}

export function capabilityKeys(provider) {
  const capabilities = provider === undefined || provider === null ? undefined : provider.capabilities
  if (capabilities === undefined || capabilities === null || typeof capabilities !== 'object' || Array.isArray(capabilities)) return []
  return Object.keys(capabilities)
}

export function resolveSubagentProvider(subagents, providerName) {
  if (typeof subagents?.getProvider !== 'function') return undefined
  try {
    return subagents.getProvider(providerName)
  } catch {
    return undefined
  }
}

/** 能力守卫：路由带 agentPreset 时，provider 必须支持独立预设选择；否则抛英文错误。 */
export function agentPresetBlockReason(route, subagents, providerName) {
  if (route.agentPreset === undefined) return undefined
  const provider = resolveSubagentProvider(subagents, providerName)
  if (provider !== undefined
    && provider.capabilities?.agentPreset
    && provider.inheritsParentContext !== true) {
    return undefined
  }
  const detail = provider === undefined
    ? 'the provider is not registered'
    : provider.inheritsParentContext === true
      ? 'the provider inherits the parent context'
      : 'the provider has no agentPreset capability'
  return `${DELEGATION_TOOL_NAME}: alias "${route.alias}" binds Agent Preset "${route.agentPreset}" but subagent provider "${providerName}" does not support independent preset selection (${detail}) — switch to a non-inheriting subagent provider or drop the route's agentPreset`
}
