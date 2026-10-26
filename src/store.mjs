/**
 * 配置文件读写（`<DSH_HOME>/subagent-setup/config.json`）。
 *
 * 为什么不用 Cordis patch（上游的做法）：
 *  - YAML 拼接要处理换行、缩进、已有条目替换，出过一次误删整段 `- insert:` 的事故；
 *  - PowerShell 等外部工具改写 JSON 时容易带 BOM，而 Node 的 JSON.parse 拒绝 BOM；
 *  - 用户目录里的 JSON 是一次写入、原子替换，出问题最多是这一份文件坏，不牵连 profile 启动。
 *
 * 不变量：
 *  - 写入**永不带 BOM**，UTF-8、两空格缩进、结尾一个换行；
 *  - 先写临时文件再 rename，避免写一半断电留下半截 JSON；
 *  - 读取时容忍 BOM（别家工具可能加过），但写回时一律去掉。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { DEFAULT_SETTINGS, normalizeSettings } from './config.mjs'

/** 配置目录名（位于 DSH_HOME 下）。 */
export const CONFIG_DIRNAME = 'subagent-setup'
/** 配置文件名。 */
export const CONFIG_FILENAME = 'config.json'
/** UTF-8 BOM 的码点。 */
const BOM = 0xfeff

/** 由 DSH_HOME 推导配置文件绝对路径。 */
export function configPath(dshHome) {
  if (typeof dshHome !== 'string' || dshHome.trim().length === 0) {
    throw new Error('configPath：需要 DSH_HOME')
  }
  return join(dshHome, CONFIG_DIRNAME, CONFIG_FILENAME)
}

/** 去掉文本开头的 BOM（如果有）。 */
export function stripBom(text) {
  if (typeof text !== 'string' || text.length === 0) return text
  return text.charCodeAt(0) === BOM ? text.slice(1) : text
}

/**
 * 读取设置。文件不存在时返回默认值而不是报错——首次运行就是这个状态。
 * @returns {Promise<{ settings: object, existed: boolean }>}
 */
export async function readSettings(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  }
  catch (error) {
    if (error && error.code === 'ENOENT') {
      return { settings: normalizeSettings(DEFAULT_SETTINGS), existed: false }
    }
    throw error
  }

  const body = stripBom(text)
  let parsed
  try {
    parsed = JSON.parse(body)
  }
  catch (error) {
    throw new Error(`配置文件不是合法 JSON：${path}（${error.message}）`)
  }
  return { settings: normalizeSettings(parsed), existed: true }
}

/**
 * 写入设置：归一化 → 写临时文件 → 原子替换。
 * @returns {Promise<object>} 实际写入的归一化设置
 */
export async function writeSettings(path, settings) {
  const normalized = normalizeSettings(settings)
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })

  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  const body = `${JSON.stringify(normalized, null, 2)}\n`
  try {
    await writeFile(tmp, body, 'utf8')
    await rename(tmp, path)
  }
  catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
  return normalized
}
