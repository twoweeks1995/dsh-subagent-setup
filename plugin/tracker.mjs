/**
 * dsh-subagent-setup —— 后台等待追踪器。
 *
 * 对应上游 dsh-subagent-model-router 的 createOrchestrationTracker +
 * registerWaitTool（lib/index.js:390-936、1333-1451），按本项目需要做有意简化：
 *   - 不跟踪 runId：本项目每次委派都拿到全新 childId，不等待同一 child 的
 *     二次运行，因此不需要 runId 维度的记录去重。
 *   - 保留上游 watchdog 的有界重扫思想（wait 内按 RESCAN_INTERVAL_MS 定期
 *     重扫 resident 列表），但去掉 manager 通知对账与 interrupted 三态；
 *     paused 子代理（idle+hasPendingInput 且上一轮以 aborted 收尾）在进入等待前
 *     与每次重扫时被识别并结算；无 aborted 证据的 idle+pending 只是瞬时排队。
 *   - rescanIntervalMs 是测试接缝：生产走默认 10 秒，测试注入小值做确定性验证。
 *
 * 为什么 pendingStarts 是全局表：subagent/start 载荷只有 { id, runId }，
 * 本文件不 import DSH 实体，无法像上游那样用 carrierKeyOf(this) 反查父代理；
 * childId 全局唯一，track() 按 childId 消费即可。
 */

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function abortError(signal) {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal) {
  if (signal !== undefined && signal !== null && signal.aborted) throw abortError(signal)
}

function raceSignal(promise, signal) {
  throwIfAborted(signal)
  if (signal === undefined || signal === null || typeof signal.addEventListener !== 'function') return promise
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(abortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function readDescriptor(child) {
  const session = child === null || child === undefined ? undefined : child.session
  if (session === undefined || session === null) return undefined
  let events
  try {
    if (typeof session.snapshotEvents === 'function') events = session.snapshotEvents()
    else if (Array.isArray(session.events)) events = session.events
    else return undefined
  } catch {
    return undefined
  }
  if (!Array.isArray(events)) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event !== null && event !== undefined && event.type === 'subagent/descriptor') return event.data
  }
  return undefined
}

// 为什么需要重扫：subagent/end 可能因 handler 抛错、事件丢失或宿主行为变化而
// 缺席，纯事件驱动会让已结束子代理的记录永远悬挂。上游用 watchdog 在同一循环里
// 定期重扫（index.js:889-904）；这里按同一思路保留 10 秒有界重扫。
const RESCAN_INTERVAL_MS = 10000

function hasPendingInput(child) {
  const inbox = child === null || child === undefined ? undefined : child.inbox
  if (inbox === undefined || inbox === null) return false
  if (inbox.hasPending === true) return true
  return (inbox.nextTurn?.length ?? 0) > 0 || (inbox.nextStep?.length ?? 0) > 0
}

function sessionEvents(session) {
  if (session === undefined || session === null) return undefined
  try {
    if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
    if (Array.isArray(session.events)) return session.events
  } catch {
    return undefined
  }
  return undefined
}

function activationBoundary(child, events) {
  const firstLiveSeq = child === null || child === undefined ? undefined : child.session?.firstLiveSeq
  if (Number.isSafeInteger(firstLiveSeq) && firstLiveSeq >= 0 && firstLiveSeq <= events.length) return firstLiveSeq
  return events.length
}

function recoveredStopReason(events) {
  const stepped = new Set()
  const claimed = new Set()
  let open
  let end
  let droppedUnrun = false
  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        open = event.data.turn
        break
      case 'step/start':
        stepped.add(event.data.turn)
        break
      case 'agent/inbox/spliced':
        if (event.data.removedCount === undefined) break
        if (event.data.outcome === 'canceled') droppedUnrun ||= event.data.inserted.length === 0
        else if (open !== undefined) claimed.add(open)
        break
      case 'turn/end': {
        const { turn, reason } = event.data
        open = undefined
        if (stepped.delete(turn) || (claimed.delete(turn) && reason.kind !== 'completed')) {
          end = reason
          droppedUnrun = false
        }
        break
      }
      default:
        break
    }
  }
  switch (end === undefined ? undefined : end.kind) {
    case 'max-tokens': return 'max-tokens'
    case 'aborted':
    case 'interrupted': return 'aborted'
    case 'error': return 'error'
    case 'blocked': return 'refusal'
    case 'completed': return droppedUnrun ? 'aborted' : 'completed'
    case undefined: return droppedUnrun ? 'aborted' : undefined
    default: return 'error'
  }
}

function recoveredAssistantOutput(events) {
  let message
  const partial = []
  for (const event of events) {
    if (event.type === 'assistant/message' && event.data?.message?.content?.length > 0) {
      message = event.data.message.content
    } else if (event.type === 'assistant/chunk' && event.data?.chunk?.type === 'text-delta') {
      if (event.data.chunk.text.length > 0) partial.push(event.data.chunk.text)
    }
  }
  if (message !== undefined) return message
  const text = partial.join('')
  return text.length === 0 ? undefined : [{ type: 'text', text }]
}

function isParkedActivation(child) {
  if (child === null || child === undefined || child.status !== 'idle' || !hasPendingInput(child)) return false
  const events = sessionEvents(child.session)
  if (events === undefined) return false
  return recoveredStopReason(events.slice(activationBoundary(child, events))) === 'aborted'
}

function createRescanDelay(intervalMs) {
  let timer
  return {
    promise: new Promise((resolve) => {
      timer = setTimeout(resolve, intervalMs)
    }),
    cancel() {
      clearTimeout(timer)
    },
  }
}

export function createTracker(ctx, options) {
  const opts = options === undefined || options === null ? {} : options
  const { logger } = opts
  const rescanIntervalMs = Number.isSafeInteger(opts.rescanIntervalMs) && opts.rescanIntervalMs > 0
    ? opts.rescanIntervalMs
    : RESCAN_INTERVAL_MS
  const states = new Map()
  const pendingStarts = new Map()
  const earlySettlements = new Map()
  const offFns = []
  let startsInFlight = 0
  let disposed = false

  const warn = (message) => {
    try {
      if (logger !== undefined && logger !== null && typeof logger.warn === 'function') logger.warn(message)
    } catch {
      // 日志失败不能影响追踪器
    }
  }

  const stateFor = (parent) => {
    let state = states.get(parent)
    if (state === undefined) {
      state = {
        parent,
        starting: 0,
        waiting: 0,
        children: new Map(),
        waiters: new Set(),
        disposed,
      }
      states.set(parent, state)
    }
    return state
  }

  const notify = (state) => {
    for (const resolve of state.waiters) resolve()
    state.waiters.clear()
  }

  const prune = (state) => {
    if (states.get(state.parent) === state
      && state.starting === 0
      && state.waiting === 0
      && state.children.size === 0
      && state.waiters.size === 0) {
      states.delete(state.parent)
    }
  }

  const createRecord = (state, childId, model, label) => {
    let resolve
    const settled = new Promise((done) => {
      resolve = done
    })
    const record = {
      subagentId: childId,
      model,
      label,
      resolve,
      settled,
      settlement: undefined,
      scan: undefined,
    }
    state.children.set(childId, record)
    return record
  }

  const settle = (record, info) => {
    if (record.settlement !== undefined) return
    record.settlement = {
      subagentId: record.subagentId,
      ...(record.model === undefined ? {} : { model: record.model }),
      label: record.label,
      stopReason: String(info.stopReason),
      output: Array.isArray(info.lastAssistantMessage) ? info.lastAssistantMessage : [],
    }
    record.resolve(record.settlement)
  }

  const findUnsettled = (childId) => {
    for (const state of states.values()) {
      const record = state.children.get(childId)
      if (record !== undefined && record.settlement === undefined) return record
    }
    return undefined
  }

  const discoverResidentChildren = (state) => {
    const agents = ctx.get('agents')
    if (agents === undefined || agents === null || typeof agents.list !== 'function') return
    for (const child of agents.list()) {
      if (child === null || typeof child !== 'object' || typeof child.id !== 'string') continue
      if (child.id === state.parent.id) continue
      const candidate = child.status === 'running' || (child.status === 'idle' && hasPendingInput(child))
      if (!candidate) continue
      const header = child.session === undefined || child.session === null ? undefined : child.session.header
      if (header === undefined || header.origin !== 'subagent' || header.parentSession !== state.parent.id) continue
      if (state.children.has(child.id)) continue
      if (child.status !== 'running' && !isParkedActivation(child)) continue
      const descriptor = readDescriptor(child)
      if (descriptor === undefined || descriptor.mode !== 'continuable') continue
      const label = typeof child.label === 'string' ? child.label : descriptor.label
      if (typeof label !== 'string') {
        warn('[subagent-setup] 无法认领 resident 子代理 ' + child.id + '：缺少 label')
        continue
      }
      createRecord(state, child.id, descriptor.agentModel, label)
    }
  }

  const probePausedRecords = (state) => {
    if (state.disposed) return
    const agents = ctx.get('agents')
    if (agents === undefined || agents === null || typeof agents.list !== 'function') return
    const pausedById = new Set()
    for (const child of agents.list()) {
      if (child === null || typeof child !== 'object' || typeof child.id !== 'string') continue
      if (isParkedActivation(child)) pausedById.add(child.id)
    }
    for (const record of [...state.children.values()]) {
      if (record.settlement !== undefined || !pausedById.has(record.subagentId)) continue
      settle(record, { stopReason: 'paused', lastAssistantMessage: [] })
      warn('[subagent-setup] 子代理 ' + record.subagentId + ' 处于 paused，按 paused 结算')
    }
  }

  const rescanStaleRecords = (state) => {
    if (state.disposed) return
    const agents = ctx.get('agents')
    const entries = agents === undefined || agents === null || typeof agents.list !== 'function' ? [] : agents.list()
    const runningById = new Set()
    const childById = new Map()
    for (const child of entries) {
      if (child === null || typeof child !== 'object' || typeof child.id !== 'string') continue
      childById.set(child.id, child)
      if (child.status === 'running') runningById.add(child.id)
    }
    for (const record of [...state.children.values()]) {
      if (record.settlement !== undefined) continue
      const child = childById.get(record.subagentId)

      // 不在 list：进程里已无该子代理，不会再有事性事件
      if (child === undefined) {
        settle(record, { stopReason: 'unknown', lastAssistantMessage: [] })
        warn('[subagent-setup] 子代理 ' + record.subagentId + ' 已不在 resident 列表中，按 unknown 结算')
        continue
      }

      // running：继续等
      if (runningById.has(record.subagentId)) {
        record.scan = undefined
        continue
      }

      // 其他非 idle 状态：进程内但已不再运行
      if (child.status !== 'idle') {
        record.scan = undefined
        settle(record, { stopReason: 'unknown', lastAssistantMessage: [] })
        warn('[subagent-setup] 子代理 ' + record.subagentId + ' 状态为 ' + child.status + '，按 unknown 结算')
        continue
      }

      // idle + 有 pending：只有带 aborted 终态证据才算 paused，否则继续等
      if (hasPendingInput(child)) {
        record.scan = undefined
        if (isParkedActivation(child)) {
          settle(record, { stopReason: 'paused', lastAssistantMessage: [] })
          warn('[subagent-setup] 子代理 ' + record.subagentId + ' 处于 paused，按 paused 结算')
        }
        // 无 aborted 终态证据的 idle+pending 只是瞬时排队，继续等 end 事件
        continue
      }

      // idle 且无 pending：连续两次重扫无新 session 事件才允许结算
      let source = child
      if (typeof agents.get === 'function') {
        try {
          const fetched = agents.get(record.subagentId)
          if (fetched !== undefined && fetched !== null) source = fetched
        } catch {
          // 拿不到 agent 对象就退回 list 条目
        }
      }
      const events = sessionEvents(source.session)
      const eventCount = Array.isArray(events) ? events.length : -1
      let scan = record.scan
      if (scan === undefined) scan = { idleNoPendingCount: 0, lastEventCount: -1 }
      if (scan.idleNoPendingCount === 0) {
        // 第一次观察到该状态：先记为候选，不结算
        scan.idleNoPendingCount = 1
        scan.lastEventCount = eventCount
        record.scan = scan
        continue
      }
      if (eventCount !== scan.lastEventCount) {
        // 期间出现了新的 session 事件，说明可能还在产出，重置候选计数
        scan.idleNoPendingCount = 1
        scan.lastEventCount = eventCount
        record.scan = scan
        continue
      }
      // 连续第二次观察到同一状态且无新事件：尽力恢复最后一条 assistant 输出
      const output = recoveredAssistantOutput(events === undefined ? [] : events)
      if (output !== undefined) {
        settle(record, { stopReason: 'completed', lastAssistantMessage: output })
        warn('[subagent-setup] 子代理 ' + record.subagentId + ' 已 idle 且无新事件，按 completed 恢复输出')
      } else {
        settle(record, { stopReason: 'unknown', lastAssistantMessage: [] })
        warn('[subagent-setup] 子代理 ' + record.subagentId + ' 已 idle 且无新事件，按 unknown 结算')
      }
      record.scan = undefined
    }
  }

  const collectSettlements = (state, records) => {
    if (state.starting > 0) return undefined
    const hasUnclaimed = [...state.children.values()].some((record) => !records.includes(record))
    if (hasUnclaimed) return undefined
    if (!records.every((record) => record.settlement !== undefined)) return undefined
    const settlements = records.map((record) => record.settlement)
    for (const record of records) {
      if (state.children.get(record.subagentId) === record) state.children.delete(record.subagentId)
    }
    prune(state)
    return settlements
  }

  const onSubagentStart = (info) => {
    if (disposed || startsInFlight === 0) return
    if (info === null || typeof info !== 'object' || typeof info.id !== 'string') return
    pendingStarts.set(info.id, info)
  }

  const onSubagentEnd = (info) => {
    if (disposed) return
    if (info === null || typeof info !== 'object' || typeof info.id !== 'string') return
    const record = findUnsettled(info.id)
    if (record !== undefined) {
      settle(record, info)
      return
    }
    if (startsInFlight > 0) earlySettlements.set(info.id, info)
  }

  const abortState = (state) => {
    state.disposed = true
    startsInFlight -= state.starting
    if (startsInFlight < 0) startsInFlight = 0
    state.starting = 0
    for (const record of state.children.values()) {
      settle(record, { stopReason: 'aborted', lastAssistantMessage: [] })
    }
    state.children.clear()
    states.delete(state.parent)
    notify(state)
  }

  const onAgentDisposed = (payload) => {
    if (disposed) return
    const agent = payload === null || payload === undefined ? undefined : payload.agent
    if (agent === undefined || agent === null) return
    const state = states.get(agent)
    if (state === undefined) return
    abortState(state)
    if (startsInFlight === 0) {
      pendingStarts.clear()
      earlySettlements.clear()
    }
  }

  const onSessionDisposed = (session) => {
    if (disposed) return
    const sessionId = session === null || session === undefined ? undefined : session.id
    if (typeof sessionId !== 'string') return
    // 子会话被回收 **不等于** 子代理运行失败：DSH 会在 subagent/end 之前就销毁会话。
    // 因此这里只处理"父会话自己消失"（父没了，它的等待也就无意义），
    // 绝不用 session/disposed 去结算子代理记录。与上游一致（上游只在 agent/disposed 上收尾）。
    for (const state of [...states.values()]) {
      if (state.parent.id !== sessionId) continue
      abortState(state)
      break
    }
  }

  const listen = (event, handler) => {
    try {
      const off = ctx.on(event, handler)
      if (typeof off === 'function') offFns.push(off)
    } catch (error) {
      warn('[subagent-setup] 监听 ' + event + ' 失败：' + errorMessage(error))
    }
  }

  listen('subagent/start', onSubagentStart)
  listen('subagent/end', onSubagentEnd)
  listen('agent/disposed', onAgentDisposed)
  listen('session/disposed', onSessionDisposed)

  if (typeof ctx.effect === 'function') {
    try {
      ctx.effect(() => () => dispose(), '[subagent-setup] wait-for-subagents tracker')
    } catch {
      // 宿主不支持 effect 时 dispose 仍由调用方手动调用
    }
  }

  function begin(parent) {
    const state = stateFor(parent)
    if (state.disposed) return state
    state.starting += 1
    startsInFlight += 1
    return state
  }

  function track(state, childId, alias, label) {
    if (state.disposed || typeof childId !== 'string') return
    pendingStarts.delete(childId)
    let record = state.children.get(childId)
    if (record === undefined) {
      record = createRecord(state, childId, alias, label)
    } else {
      if (alias !== undefined) record.model = alias
      if (label !== undefined) record.label = label
      if (record.settlement !== undefined) {
        if (record.model === undefined) delete record.settlement.model
        else record.settlement.model = record.model
        record.settlement.label = record.label
      }
    }
    const early = earlySettlements.get(childId)
    if (early !== undefined) {
      earlySettlements.delete(childId)
      settle(record, early)
    }
  }

  function finish(parent, state) {
    if (state.disposed) return
    state.starting -= 1
    startsInFlight -= 1
    if (state.starting < 0) state.starting = 0
    if (startsInFlight < 0) startsInFlight = 0
    notify(state)
    if (startsInFlight === 0) {
      pendingStarts.clear()
      earlySettlements.clear()
    }
    prune(state)
  }

  function nextChange(state) {
    let waiter
    const changed = new Promise((resolve) => {
      waiter = () => {
        state.waiters.delete(waiter)
        resolve()
      }
      state.waiters.add(waiter)
    })
    changed.cleanup = () => state.waiters.delete(waiter)
    return changed
  }

  async function wait(parent, signal) {
    const state = stateFor(parent)
    state.waiting += 1
    try {
      while (true) {
        throwIfAborted(signal)
        if (state.disposed) return []
        while (state.starting > 0) {
          const startingChange = nextChange(state)
          try {
            await raceSignal(startingChange, signal)
          } finally {
            startingChange.cleanup()
          }
          if (state.disposed) return []
        }
        discoverResidentChildren(state)
        const records = [...state.children.values()]
        if (records.length === 0) return []
        probePausedRecords(state)
        const earlyResult = collectSettlements(state, records)
        if (earlyResult !== undefined) return earlyResult
        const allSettled = Promise.all(records.map((record) => record.settled))
        const changed = nextChange(state)
        const rescan = createRescanDelay(rescanIntervalMs)
        if (state.disposed) {
          changed.cleanup()
          rescan.cancel()
          return []
        }
        let outcome
        try {
          outcome = await raceSignal(Promise.race([
            allSettled.then((value) => ({ kind: 'settled', value })),
            changed.then(() => ({ kind: 'changed' })),
            rescan.promise.then(() => ({ kind: 'rescan' })),
          ]), signal)
        } finally {
          rescan.cancel()
          changed.cleanup()
        }
        if (state.disposed) return []
        if (state.starting > 0) continue
        if (outcome.kind === 'rescan') {
          rescanStaleRecords(state)
          continue
        }
        const finalResult = collectSettlements(state, records)
        if (finalResult !== undefined) return finalResult
      }
    } finally {
      state.waiting -= 1
      prune(state)
    }
  }

  function dispose() {
    if (disposed) return
    disposed = true
    for (const off of offFns) {
      try {
        off()
      } catch {
        // 解绑失败不阻塞 dispose
      }
    }
    offFns.length = 0
    for (const state of states.values()) {
      state.disposed = true
      notify(state)
    }
    states.clear()
    pendingStarts.clear()
    earlySettlements.clear()
    startsInFlight = 0
  }

  return { begin, track, finish, wait, dispose }
}

export function createWaitTool(tracker, options) {
  const { name } = options
  return {
    name,
    description: 'Wait for every outstanding continuable background subagent started by this agent. Call it once after issuing all intended delegations; it blocks until they settle and returns their results, so do not poll.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            subagentId: { type: 'string' },
            model: { type: 'string' },
            label: { type: 'string' },
            stopReason: { type: 'string' },
            output: { type: 'array', items: {} },
          },
          required: ['subagentId', 'label', 'stopReason', 'output'],
        },
      },
      render(_args, settlements) {
        if (!Array.isArray(settlements) || settlements.length === 0) {
          return [{ type: 'text', text: '(no outstanding background subagents)' }]
        }
        const blocks = []
        settlements.forEach((entry, index) => {
          if (index > 0) blocks.push({ type: 'text', text: '\n\n' })
          const model = entry.model === undefined ? '' : ' (' + entry.model + ')'
          blocks.push({ type: 'text', text: entry.subagentId + ' [' + entry.stopReason + '] ' + entry.label + model })
          if (Array.isArray(entry.output) && entry.output.length > 0) {
            blocks.push({ type: 'text', text: '\n' }, ...entry.output)
          }
        })
        return blocks
      },
    },
    isConcurrencySafe: () => true,
    execute(_args, exec) {
      const parent = exec === undefined || exec === null ? undefined : exec.agent
      if (parent === undefined) throw new Error(name + ' requires a calling agent')
      return tracker.wait(parent, exec.signal)
    },
  }
}
