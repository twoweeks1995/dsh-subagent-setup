/** 从 ctx.llm 汇总 provider/model 目录；供 catalog 工具与设置页的 /catalog 路由共用。 */
import { errorMessage } from './util.mjs'

export async function collectModelCatalog(ctx, exec) {
  const providerEntries = ctx.llm.listProviders()
  const providers = await Promise.all(providerEntries.map(async (provider) => {
    try {
      const models = await ctx.llm.listModels(provider.id)
      return {
        id: provider.id,
        name: provider.name,
        models: models.map((model) => ({
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(model.inputModalities === undefined ? {} : { inputModalities: [...model.inputModalities] }),
        })),
      }
    } catch (error) {
      // 单个 provider 失败只降级这一项，不拖垮整个目录。
      return { id: provider.id, name: provider.name, models: [], error: errorMessage(error) }
    }
  }))

  const currentProvider = exec?.agent?.options?.provider
  const currentModel = exec?.agent?.options?.model
  return {
    ...(typeof currentProvider === 'string' && typeof currentModel === 'string'
      ? { current: { provider: currentProvider, model: currentModel } }
      : {}),
    providers,
  }
}
