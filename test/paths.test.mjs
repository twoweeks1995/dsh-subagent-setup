import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveDshHome } from '../src/paths.mjs'

test('优先使用 DSH_HOME', () => {
  assert.equal(resolveDshHome({ env: { DSH_HOME: 'D:\\DSH-Home' }, home: 'C:\\Users\\x' }), 'D:\\DSH-Home')
})

test('DSH_HOME 两侧空白被裁掉', () => {
  assert.equal(resolveDshHome({ env: { DSH_HOME: '  D:\\DSH-Home  ' }, home: 'C:\\Users\\x' }), 'D:\\DSH-Home')
})

test('没有 DSH_HOME 时回退到 ~/.dsh', () => {
  assert.equal(resolveDshHome({ env: {}, home: 'C:\\Users\\x' }), 'C:\\Users\\x\\.dsh')
})

test('两者都没有时报错', () => {
  assert.throws(() => resolveDshHome({ env: {}, home: '' }), /DSH_HOME/)
})
