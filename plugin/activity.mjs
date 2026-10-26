/**
 * list_agents 过滤所需的最小活动账本：每个 parent 会话的轮数与
 * 每个 child 的最近接触轮。未知接触的 child 一律保留（宁可多显示）。
 */
import { filterListing } from '../src/policy.mjs'

export function isParentOrUserMessage(message) {
  return message?.source?.kind === 'user'
    || (message?.source?.kind === 'coordinator'
      && message.source.form === 'relay'
      && typeof message.source.senderSessionId === 'string')
}

export function countMessageTurns(session) {
  let events
  if (typeof session?.snapshotEvents === 'function') events = session.snapshotEvents()
  else if (Array.isArray(session?.events)) events = session.events
  else return 0
  return events.filter((event) => event.type === 'user/message' && isParentOrUserMessage(event.data)).length
}

export function createListingActivity(ctx) {
  const parents = new Map()

  const stateFor = (parentId, parentAgent) => {
    let state = parents.get(parentId)
    if (state === undefined) {
      state = {
        turns: parentAgent === undefined ? 0 : countMessageTurns(parentAgent.session),
        lastContactByChild: new Map(),
      }
      parents.set(parentId, state)
    }
    return state
  }

  return {
    observeSessionEvent(session, event) {
      if (event.type !== 'user/message' || !isParentOrUserMessage(event.data)) return
      const sessionId = session?.header?.id
      if (typeof sessionId !== 'string') return
      const own = parents.get(sessionId)
      if (own === undefined) {
        stateFor(sessionId, ctx.get('agents')?.get(sessionId))
      } else {
        own.turns += 1
      }
      if (session.header?.origin === 'subagent' && typeof session.header?.parentSession === 'string') {
        const parentId = session.header.parentSession
        const parentState = stateFor(parentId, ctx.get('agents')?.get(parentId))
        parentState.lastContactByChild.set(sessionId, parentState.turns)
      }
    },
    markStart(parentId, childId) {
      const state = stateFor(parentId, ctx.get('agents')?.get(parentId))
      state.lastContactByChild.set(childId, state.turns)
    },
    disposeSession(session) {
      const id = typeof session === 'string' ? session : session?.header?.id ?? session?.id
      if (typeof id !== 'string') return
      parents.delete(id)
      for (const state of parents.values()) state.lastContactByChild.delete(id)
    },
    filter(parent, entries, inactivityTurns) {
      const state = stateFor(parent.id, parent)
      return filterListing(entries, {
        parentId: parent.id,
        turnOf: state.lastContactByChild,
        currentTurn: state.turns,
        inactivityTurns,
      })
    },
  }
}
