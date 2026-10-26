/**
 * 路由清单渲染（纯函数）。这里输出的是给模型看的文本，一律英文。
 */
import { routeKey } from './config.mjs'

/**
 * 渲染一条路由的推理档位后缀。
 * reasoning 为 undefined 表示"档位未知"（不输出大括号段）；
 * reasoning 为 null 表示"该路由明确没有推理档位"。
 */
function renderEffortSuffix(entry, reasoning) {
  const parts = []
  if (entry.reasoningEffort !== undefined) parts.push(`default effort: ${entry.reasoningEffort}`)
  if (reasoning !== undefined && reasoning !== null && reasoning.efforts.length > 0) {
    const efforts = reasoning.efforts.map((effort) => (effort === reasoning.defaultEffort ? `${effort}*` : effort)).join('|')
    parts.push(`efforts: ${efforts}`)
  } else if (reasoning === null) {
    parts.push('no reasoning effort')
  }
  return parts.length === 0 ? '' : ` {${parts.join('; ')}}`
}

/** 渲染单条路由：- alias: displayName (provider/model)[ tags][ {档位}] — description */
export function renderModelRoute(entry, effortInfo) {
  const tags = (entry.tags ?? []).length === 0 ? '' : ` [tags: ${entry.tags.join(', ')}]`
  const effort = renderEffortSuffix(entry, effortInfo)
  return `- ${entry.alias}: ${entry.displayName ?? entry.alias} (${entry.provider}/${entry.model})${tags}${effort} — ${entry.description}`
}

/** 把全部路由渲染成多行清单；efforts 缺失或为 null 时按"档位未知"处理。 */
export function renderConfiguredModels(models, efforts) {
  return models.map((entry) => renderModelRoute(entry, efforts?.get(routeKey(entry.provider, entry.model)))).join('\n')
}

/** 渲染只读模型目录工具的结果。 */
export function renderCatalogResult(view) {
  const lines = []
  if (view.current !== undefined) {
    lines.push(`Current agent route: ${view.current.provider}/${view.current.model}`)
  }
  for (const provider of view.providers) {
    lines.push(`Provider ${provider.name} (${provider.id})`)
    if (provider.error !== undefined) {
      lines.push(`  Catalog unavailable: ${provider.error}`)
      continue
    }
    if (provider.models.length === 0) {
      lines.push('  No models advertised (the route may still accept manually configured model ids).')
      continue
    }
    for (const model of provider.models) {
      const description = model.description === undefined ? '' : ` — ${model.description}`
      lines.push(`  - ${model.name} (${model.id})${description}`)
    }
  }
  return lines.length === 0 ? 'No registered model providers were found.' : lines.join('\n')
}
