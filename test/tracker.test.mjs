import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createTracker, createWaitTool } from '../plugin/tracker.mjs'

function createFakeCtx(options) {
  const opts = options === undefined ? {} : options
  const handlers = new Map()
  const agents = {
    list: opts.agentsList === undefined ? () => [] : opts.agentsList,
    get: opts.agentsGet === undefined ? () => undefined : opts.agentsGet,
  }
  return {
    on(event, handler) {
      handlers.set(event, handler)
      return () => {
        if (handlers.get(event) === handler) handlers.delete(event)
      }
    },
    get(name) {
      return name === 'agents' ? agents : undefined
    },
    emit(event, payload) {
      const handler = handlers.get(event)
      if (handler !== undefined) handler(payload)
    },
    agents,
  }
}

const parent = { id: 'parent-session' }

function endEvent(id, output) {
  return {
    id,
    stopReason: 'completed',
    lastAssistantMessage: output === undefined ? [] : output,
  }
}

function tick(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms === undefined ? 10 : ms))
}

test('正常结算后 wait 立即返回', async () => {
  const ctx = createFakeCtx()
  const tracker = createTracker(ctx, {})
  const state = tracker.begin(parent)
  tracker.track(state, 'child-1', 'alias-a', '任务 A')
  tracker.finish(parent, state)
  ctx.emit('subagent/end', endEvent('child-1', [{ type: 'text', text: 'done' }]))
  const settlements = await tracker.wait(parent)
  assert.equal(settlements.length, 1)
  assert.deepEqual(settlements[0], {
    subagentId: 'child-1',
    model: 'alias-a',
    label: '任务 A',
    stopReason: 'completed',
    output: [{ type: 'text', text: 'done' }],
  })
})

test('子代理先 subagent/end 后 track 不丢结果', async () => {
  const ctx = createFakeCtx()
  const tracker = createTracker(ctx, {})
  const state = tracker.begin(parent)
  ctx.emit('subagent/end', endEvent('child-2', [{ type: 'text', text: 'early' }]))
  tracker.track(state, 'child-2', 'alias-b', '任务 B')
  tracker.finish(parent, state)
  const settlements = await tracker.wait(parent)
  assert.equal(settlements.length, 1)
  assert.equal(settlements[0].subagentId, 'child-2')
  assert.deepEqual(settlements[0].output, [{ type: 'text', text: 'early' }])
})

test('两个子代理只有一个结束时不提前返回', async () => {
  const ctx = createFakeCtx()
  const tracker = createTracker(ctx, {})
  const first = tracker.begin(parent)
  tracker.track(first, 'child-a', 'alias', 'A')
  tracker.finish(parent, first)
  const second = tracker.begin(parent)
  tracker.track(second, 'child-b', 'alias', 'B')
  tracker.finish(parent, second)

  ctx.emit('subagent/end', endEvent('child-a'))
  let settled = false
  const waiting = tracker.wait(parent).then((value) => {
    settled = true
    return value
  })
  await tick()
  assert.equal(settled, false)

  ctx.emit('subagent/end', endEvent('child-b'))
  const settlements = await waiting
  assert.equal(settled, true)
  assert.equal(settlements.length, 2)
})

test('parent 名下混入别人的子代理时不误等', async () => {
  const foreign = {
    id: 'foreign-child',
    status: 'running',
    session: { header: { origin: 'subagent', parentSession: 'someone-else' } },
  }
  const ctx = createFakeCtx({ agentsList: () => [foreign] })
  const tracker = createTracker(ctx, {})
  const settlements = await tracker.wait(parent)
  assert.deepEqual(settlements, [])
})

test('重载后无内存登记时能从 agents.list() 认领并完成 wait', async () => {
  const resident = {
    id: 'resident-child',
    status: 'running',
    session: {
      header: { origin: 'subagent', parentSession: parent.id },
      events: [{
        type: 'subagent/descriptor',
        data: { mode: 'continuable', label: 'resident 任务', agentModel: 'alias-r' },
      }],
    },
  }
  const ctx = createFakeCtx({ agentsList: () => [resident] })
  const tracker = createTracker(ctx, {})
  const waiting = tracker.wait(parent)
  ctx.emit('subagent/end', endEvent('resident-child', [{ type: 'text', text: 'resumed' }]))
  const settlements = await waiting
  assert.equal(settlements.length, 1)
  assert.deepEqual(settlements[0], {
    subagentId: 'resident-child',
    model: 'alias-r',
    label: 'resident 任务',
    stopReason: 'completed',
    output: [{ type: 'text', text: 'resumed' }],
  })
})

test('dispose 后再 wait 不崩', async () => {
  const ctx = createFakeCtx()
  const tracker = createTracker(ctx, {})
  const state = tracker.begin(parent)
  tracker.track(state, 'child-c', 'alias', 'C')
  tracker.dispose()
  assert.deepEqual(await tracker.wait(parent), [])

  ctx.emit('subagent/end', endEvent('child-c'))
  const late = tracker.begin(parent)
  tracker.track(late, 'child-d', 'alias', 'D')
  tracker.finish(parent, late)
  assert.deepEqual(await tracker.wait(parent), [])
})

test('agent/disposed 时进行中的 wait 不挂起', async () => {
  const ctx = createFakeCtx()
  const tracker = createTracker(ctx, {})
  const state = tracker.begin(parent)
  tracker.track(state, 'child-x', 'alias', 'X')
  tracker.finish(parent, state)
  const waiting = tracker.wait(parent)
  ctx.emit('agent/disposed', { agent: parent })
  assert.deepEqual(await waiting, [])
})

test('session/disposed 不得把子代理判成中止，必须等 subagent/end 带出真实输出', async () => {
  const ctx = createFakeCtx()
  const tracker = createTracker(ctx, {})
  const state = tracker.begin(parent)
  tracker.track(state, 'child-y', 'alias', 'Y')
  tracker.finish(parent, state)
  const waiting = tracker.wait(parent)
  let settled = false
  waiting.then(() => { settled = true })
  ctx.emit('session/disposed', { id: 'child-y' })
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(settled, false, '子会话被回收时不得结算子代理记录')
  ctx.emit('subagent/end', { id: 'child-y', stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: 'ok' }] })
  const settlements = await waiting
  assert.equal(settlements.length, 1)
  assert.equal(settlements[0].stopReason, 'completed')
  assert.deepEqual(settlements[0].output, [{ type: 'text', text: 'ok' }])
})

test('createWaitTool 返回合法工具描述符并走 tracker.wait', async () => {
  const ctx = createFakeCtx()
  const tracker = createTracker(ctx, {})
  const tool = createWaitTool(tracker, { name: 'wait-for-subagents' })

  assert.equal(tool.name, 'wait-for-subagents')
  assert.equal(typeof tool.description, 'string')
  assert.match(tool.description, /do not poll/i)
  assert.equal(tool.isConcurrencySafe(), true)
  assert.deepEqual(tool.parameters, { type: 'object', additionalProperties: false, properties: {} })
  assert.equal(tool.output.schema.type, 'array')
  assert.equal(tool.output.schema.items.properties.subagentId.type, 'string')
  assert.deepEqual(tool.output.schema.items.required, ['subagentId', 'label', 'stopReason', 'output'])
  assert.deepEqual(tool.output.schema.items.properties.output, { type: 'array', items: {} })

  const state = tracker.begin(parent)
  tracker.track(state, 'child-t', 'alias', 'tool 任务')
  tracker.finish(parent, state)
  ctx.emit('subagent/end', endEvent('child-t', [{ type: 'text', text: 'tooled' }]))

  const result = await tool.execute({}, { agent: parent, signal: undefined })
  assert.equal(result.length, 1)
  assert.equal(result[0].subagentId, 'child-t')

  assert.deepEqual(tool.output.render({}, []), [{ type: 'text', text: '(no outstanding background subagents)' }])
  const rendered = tool.output.render({}, result)
  assert.equal(Array.isArray(rendered), true)
  assert.equal(rendered.length > 0, true)
})


test('end 事件丢失时 wait 经有界重扫按 unknown 返回', async () => {
  const lostChild = {
    id: 'child-lost',
    status: 'idle',
    inbox: { hasPending: false, nextTurn: [], nextStep: [] },
    session: { header: { origin: 'subagent', parentSession: parent.id } },
  }
  const ctx = createFakeCtx({ agentsList: () => [lostChild] })
  const tracker = createTracker(ctx, { rescanIntervalMs: 15 })
  const state = tracker.begin(parent)
  tracker.track(state, 'child-lost', 'alias', 'lost')
  tracker.finish(parent, state)
  const startedAt = Date.now()
  const settlements = await tracker.wait(parent)
  assert.ok(Date.now() - startedAt < 5000)
  assert.equal(settlements.length, 1)
  assert.equal(settlements[0].subagentId, 'child-lost')
  assert.equal(settlements[0].stopReason, 'unknown')
  assert.deepEqual(settlements[0].output, [])
})

test('重扫不误结算仍在 running 的子代理', async () => {
  const runningChild = {
    id: 'child-running',
    status: 'running',
    session: { header: { origin: 'subagent', parentSession: parent.id } },
  }
  const ctx = createFakeCtx({ agentsList: () => [runningChild] })
  const tracker = createTracker(ctx, { rescanIntervalMs: 15 })
  const state = tracker.begin(parent)
  tracker.track(state, 'child-running', 'alias', 'running')
  tracker.finish(parent, state)

  let settled = false
  const waiting = tracker.wait(parent).then((value) => {
    settled = true
    return value
  })
  await tick(80)
  assert.equal(settled, false)

  ctx.emit('subagent/end', endEvent('child-running', [{ type: 'text', text: 'finally' }]))
  const settlements = await waiting
  assert.equal(settled, true)
  assert.equal(settlements.length, 1)
  assert.equal(settlements[0].stopReason, 'completed')
})

test('paused 子代理在进入等待时立即按 paused 结算', async () => {
  const pausedChild = {
    id: 'child-paused',
    status: 'idle',
    inbox: { hasPending: true },
    session: {
      header: { origin: 'subagent', parentSession: parent.id },
      firstLiveSeq: 0,
      events: [
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'step/start', data: { turn: 1 } },
        { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } },
      ],
    },
  }
  const ctx = createFakeCtx({ agentsList: () => [pausedChild] })
  // 故意用 5 秒重扫周期：若依赖 tick 会等到 5 秒，这里验证的是立即探测生效
  const tracker = createTracker(ctx, { rescanIntervalMs: 5000 })
  const state = tracker.begin(parent)
  tracker.track(state, 'child-paused', 'alias', 'paused')
  tracker.finish(parent, state)
  const startedAt = Date.now()
  const settlements = await tracker.wait(parent)
  assert.ok(Date.now() - startedAt < 1000)
  assert.equal(settlements.length, 1)
  assert.equal(settlements[0].subagentId, 'child-paused')
  assert.equal(settlements[0].stopReason, 'paused')
  assert.deepEqual(settlements[0].output, [])
})

test('重扫 tick 将中途进入 paused 的子代理按 paused 结算', async () => {
  const runningChild = {
    id: 'child-late-paused',
    status: 'running',
    session: { header: { origin: 'subagent', parentSession: parent.id } },
  }
  let showsPaused = false
  const ctx = createFakeCtx({
    agentsList: () => (showsPaused ? [{
      id: 'child-late-paused',
      status: 'idle',
      inbox: { hasPending: true },
      session: {
        header: { origin: 'subagent', parentSession: parent.id },
        firstLiveSeq: 0,
        events: [
          { type: 'turn/start', data: { turn: 1 } },
          { type: 'step/start', data: { turn: 1 } },
          { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } },
        ],
      },
    }] : [runningChild]),
  })
  const tracker = createTracker(ctx, { rescanIntervalMs: 20 })
  const state = tracker.begin(parent)
  tracker.track(state, 'child-late-paused', 'alias', 'late')
  tracker.finish(parent, state)

  const waiting = tracker.wait(parent)
  setTimeout(() => { showsPaused = true }, 5)
  const settlements = await waiting
  assert.equal(settlements.length, 1)
  assert.equal(settlements[0].subagentId, 'child-late-paused')
  assert.equal(settlements[0].stopReason, 'paused')
  assert.deepEqual(settlements[0].output, [])
})


test('wait 不因陈旧快照漏掉并发新增的子代理', async () => {
  const ctx = createFakeCtx()
  const tracker = createTracker(ctx, {})
  const stateA = tracker.begin(parent)
  tracker.track(stateA, 'child-a', 'alias', 'A')
  tracker.finish(parent, stateA)

  const waiting = tracker.wait(parent)
  ctx.emit('subagent/end', endEvent('child-a'))
  // 快照醒来之前，另一笔委派登记了 B
  const stateB = tracker.begin(parent)
  tracker.track(stateB, 'child-b', 'alias', 'B')
  tracker.finish(parent, stateB)

  let settled = false
  const tracked = waiting.then((value) => {
    settled = true
    return value
  })
  await tick(30)
  assert.equal(settled, false)

  ctx.emit('subagent/end', endEvent('child-b'))
  const settlements = await tracked
  assert.equal(settlements.length, 2)
})

test('重载后 idle+pending(parked) 的 resident 子被认领并按 paused 结算', async () => {
  const parkedResident = {
    id: 'resident-parked',
    status: 'idle',
    inbox: { hasPending: true },
    session: {
      header: { origin: 'subagent', parentSession: parent.id },
      firstLiveSeq: 0,
      events: [
        { type: 'subagent/descriptor', data: { mode: 'continuable', label: 'parked 任务', agentModel: 'alias-p' } },
        { type: 'turn/start', data: { turn: 1 } },
        { type: 'step/start', data: { turn: 1 } },
        { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } },
      ],
    },
  }
  const ctx = createFakeCtx({ agentsList: () => [parkedResident] })
  const tracker = createTracker(ctx, { rescanIntervalMs: 5000 })
  const startedAt = Date.now()
  const settlements = await tracker.wait(parent)
  assert.ok(Date.now() - startedAt < 1000)
  assert.equal(settlements.length, 1)
  assert.equal(settlements[0].subagentId, 'resident-parked')
  assert.equal(settlements[0].stopReason, 'paused')
  assert.deepEqual(settlements[0].output, [])
})

test('瞬时 idle+pending 无 aborted 证据时不被结算', async () => {
  const transientChild = {
    id: 'child-transient',
    status: 'idle',
    inbox: { hasPending: true },
    session: {
      header: { origin: 'subagent', parentSession: parent.id },
      firstLiveSeq: 0,
      events: [],
    },
  }
  const ctx = createFakeCtx({ agentsList: () => [transientChild] })
  const tracker = createTracker(ctx, { rescanIntervalMs: 15 })
  const state = tracker.begin(parent)
  tracker.track(state, 'child-transient', 'alias', 'transient')
  tracker.finish(parent, state)

  let settled = false
  const waiting = tracker.wait(parent).then((value) => {
    settled = true
    return value
  })
  await tick(80)
  assert.equal(settled, false)

  ctx.emit('subagent/end', endEvent('child-transient', [{ type: 'text', text: 'real output' }]))
  const settlements = await waiting
  assert.equal(settled, true)
  assert.equal(settlements[0].stopReason, 'completed')
  assert.deepEqual(settlements[0].output, [{ type: 'text', text: 'real output' }])
})

test('idle 无 pending 时真实 end 先到则返回真实输出', async () => {
  const child = {
    id: 'child-idle-race',
    status: 'idle',
    inbox: { hasPending: false, nextTurn: [], nextStep: [] },
    session: { header: { origin: 'subagent', parentSession: parent.id } },
  }
  const ctx = createFakeCtx({ agentsList: () => [child] })
  const tracker = createTracker(ctx, { rescanIntervalMs: 10 })
  const state = tracker.begin(parent)
  tracker.track(state, 'child-idle-race', 'alias', 'race')
  tracker.finish(parent, state)

  const waiting = tracker.wait(parent)
  setTimeout(() => {
    ctx.emit('subagent/end', endEvent('child-idle-race', [{ type: 'text', text: 'real' }]))
  }, 3)
  const settlements = await waiting
  assert.equal(settlements.length, 1)
  assert.equal(settlements[0].stopReason, 'completed')
  assert.deepEqual(settlements[0].output, [{ type: 'text', text: 'real' }])
})

test('idle 无 pending 连续两次重扫后按 completed 恢复输出', async () => {
  const child = {
    id: 'child-idle-recover',
    status: 'idle',
    inbox: { hasPending: false, nextTurn: [], nextStep: [] },
    session: {
      header: { origin: 'subagent', parentSession: parent.id },
      firstLiveSeq: 0,
      events: [
        { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'recovered output' }] } } },
      ],
    },
  }
  const ctx = createFakeCtx({ agentsList: () => [child] })
  const tracker = createTracker(ctx, { rescanIntervalMs: 10 })
  const state = tracker.begin(parent)
  tracker.track(state, 'child-idle-recover', 'alias', 'recover')
  tracker.finish(parent, state)
  const startedAt = Date.now()
  const settlements = await tracker.wait(parent)
  assert.ok(Date.now() - startedAt < 2000)
  assert.equal(settlements.length, 1)
  assert.equal(settlements[0].subagentId, 'child-idle-recover')
  assert.equal(settlements[0].stopReason, 'completed')
  assert.deepEqual(settlements[0].output, [{ type: 'text', text: 'recovered output' }])
})

test('不在 agents.list() 中的未结算记录按 unknown 结算', async () => {
  const ctx = createFakeCtx({ agentsList: () => [] })
  const tracker = createTracker(ctx, { rescanIntervalMs: 10 })
  const state = tracker.begin(parent)
  tracker.track(state, 'child-gone', 'alias', 'gone')
  tracker.finish(parent, state)
  const startedAt = Date.now()
  const settlements = await tracker.wait(parent)
  assert.ok(Date.now() - startedAt < 2000)
  assert.equal(settlements.length, 1)
  assert.equal(settlements[0].subagentId, 'child-gone')
  assert.equal(settlements[0].stopReason, 'unknown')
  assert.deepEqual(settlements[0].output, [])
})
