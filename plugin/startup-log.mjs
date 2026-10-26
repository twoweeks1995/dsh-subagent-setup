/**
 * 启动诊断日志：主条目与会话条目都往同一个 last-startup.log 写。
 *
 * 选择「追加」而不是「按条目分文件」：诊断只有一个入口，追加块以 timestamp
 * 行自然分隔，按时间顺序一眼就能看清两条目的启动情况；分文件会把一次启动
 * 拆成两处，排查时要来回对照。旧实现用 writeFile 整文件覆盖，拆成两条目后
 * 后加载者会覆盖先加载者，所以这里必须改成 appendFile。
 */
import { homedir } from 'node:os'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { resolveDshHome } from '../src/paths.mjs'

export function stackHead(error, maxLines = 5) {
  if (!(error instanceof Error) || typeof error.stack !== 'string') return ''
  return error.stack.split(/\r?\n/).slice(0, maxLines).join('\n')
}

export function resolveStartupLogPath() {
  return join(resolveDshHome({ env: process.env, home: homedir() }), 'subagent-setup', 'last-startup.log')
}

/** 把一段诊断行追加写入 last-startup.log（写盘失败不得影响插件加载）。 */
export async function writeStartupDiagnostics(lines) {
  try {
    const path = resolveStartupLogPath()
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, lines.join('\n') + '\n', 'utf8')
  } catch {
    // 诊断写盘失败不得影响插件加载
  }
}

export function createStartupRecorder() {
  const lines = []
  return {
    record(line) {
      lines.push(line)
    },
    async flush() {
      if (lines.length === 0) return
      await writeStartupDiagnostics([`timestamp: ${new Date().toISOString()}`, ...lines])
      lines.length = 0
    },
  }
}
