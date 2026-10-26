import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { configPath, readSettings, stripBom, writeSettings } from '../src/store.mjs'

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'subagent-setup-'))
  try {
    return await fn(dir)
  }
  finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('configPath 拼出 DSH_HOME 下的固定路径', () => {
  assert.equal(configPath('D:\\DSH-Home'), join('D:\\DSH-Home', 'subagent-setup', 'config.json'))
  assert.throws(() => configPath(''), /DSH_HOME/)
})

test('文件不存在时返回默认值而不是报错', async () => {
  await withTempDir(async (dir) => {
    const { settings, existed } = await readSettings(join(dir, 'nope', 'config.json'))
    assert.equal(existed, false)
    assert.deepEqual(settings.models, [])
    assert.equal(settings.maxDepth, 3)
  })
})

test('写入后能读回，且文件不含 BOM', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'subagent-setup', 'config.json')
    await writeSettings(path, {
      models: [{ alias: 'deep', provider: 'acme', model: 'reasoner', description: '复杂实现' }],
    })

    const bytes = await readFile(path)
    assert.notEqual(bytes[0], 0xef, '首字节不能是 UTF-8 BOM 的 0xEF')
    assert.equal(bytes[0], 0x7b, '首字节应当是 "{"')

    const { settings, existed } = await readSettings(path)
    assert.equal(existed, true)
    assert.equal(settings.models.length, 1)
    assert.equal(settings.models[0].alias, 'deep')
  })
})

test('写入是原子的：目录里不会残留临时文件', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'subagent-setup', 'config.json')
    await writeSettings(path, { models: [] })
    await writeSettings(path, { models: [] })
    const { readdir } = await import('node:fs/promises')
    const names = await readdir(join(dir, 'subagent-setup'))
    assert.deepEqual(names, ['config.json'])
  })
})

test('读取时容忍 BOM，写入时去掉', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'config.json')
    await writeFile(path, `\uFEFF${JSON.stringify({ models: [] })}`, 'utf8')
    const { settings } = await readSettings(path)
    assert.deepEqual(settings.models, [])
    assert.equal(stripBom('\uFEFFabc'), 'abc')
    assert.equal(stripBom('abc'), 'abc')
  })
})

test('非法 JSON 报错并带上路径', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'config.json')
    await writeFile(path, '{ not json', 'utf8')
    await assert.rejects(() => readSettings(path), /不是合法 JSON/)
  })
})

test('写入前归一化：非法配置根本落不了盘', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, 'config.json')
    await assert.rejects(
      () => writeSettings(path, { models: [{ alias: 'Bad', provider: 'p', model: 'm', description: 'd' }] }),
      /alias/,
    )
    await assert.rejects(() => readFile(path), /ENOENT/)
  })
})
