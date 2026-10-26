/**
 * config.json 的定位与读写，以及「配置被写回」的通知钩子。
 *
 * 为什么用模块级回调而不是 cordis 事件：写盘发生在路由层（主条目注册的设置接口），
 * 重挂在 apply 的状态机里；两者同属主条目，但 ES 模块在同一进程内是单例，
 * 用模块级回调比在条目内传递 ctx 更直接（合并前用于跨条目通知，现在只剩这一条通路）。
 */
import { homedir } from 'node:os'
import { stat } from 'node:fs/promises'

import { configPath, readSettings, writeSettings } from '../src/store.mjs'
import { resolveDshHome } from '../src/paths.mjs'
import { errorMessage } from './util.mjs'

let configChangeListener

/** 写盘成功后调用；等监听器（主条目的 reconcile）跑完再返回。 */
export function setConfigChangeListener(listener) {
  configChangeListener = listener
}

export function clearConfigChangeListener() {
  configChangeListener = undefined
}

/** 设置接口写盘成功后调用；等监听器（哪个条目注册的就由谁跑）跑完再返回。 */
export async function notifyConfigChanged() {
  const listener = configChangeListener
  if (typeof listener !== 'function') return undefined
  try {
    return await listener()
  } catch {
    return undefined
  }
}

export function resolveConfigPath() {
  return configPath(resolveDshHome({ env: process.env, home: homedir() }))
}

/** 每次委派/配置读写时重新定位并读取 config.json；失败抛中文错误（含路径）。 */
export async function readConfigNow() {
  const path = resolveConfigPath()
  try {
    const { settings } = await readSettings(path)
    return { settings, path }
  } catch (error) {
    throw new Error(`读取子代理路由配置失败：${path}（${errorMessage(error)}）`)
  }
}

export async function readConfigView() {
  const { settings, path } = await readConfigNow()
  let revision = '0'
  try {
    revision = String((await stat(path)).mtimeMs)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  return { config: settings, revision }
}

export async function writeConfigView(config) {
  const path = resolveConfigPath()
  const written = await writeSettings(path, config)
  let revision = '0'
  try {
    revision = String((await stat(path)).mtimeMs)
  } catch {
    // 文件刚写完，stat 失败只影响 revision 展示，不掩盖写入结果。
  }
  return { config: written, revision }
}
