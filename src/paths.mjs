/**
 * DSH_HOME 解析（纯函数）。
 *
 * 宿主进程一般带 `DSH_HOME` 环境变量；没有时回退到 `~/.dsh`。
 * 单独抽出来是为了能脱离 DSH 单测——上游把这件事埋在插件里，无法验证。
 */
import { join } from 'node:path'

/**
 * @param {{ env?: Record<string, string|undefined>, home?: string }} input
 * @returns {string} DSH_HOME 绝对路径
 */
export function resolveDshHome({ env = {}, home } = {}) {
  const fromEnv = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (fromEnv.length > 0) return fromEnv
  if (typeof home !== 'string' || home.length === 0) {
    throw new Error('resolveDshHome：既没有 DSH_HOME，也没有 home 目录')
  }
  return join(home, '.dsh')
}
