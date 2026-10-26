/**
 * 列表过滤策略（纯函数）。
 * 为什么未知 lastContact 的 child 必须保留：宁可多显示，不可误藏一个
 * 仍可通过 send_message 恢复的 resident 子代理。
 */
export function filterListing(entries, ctx) {
  const { turnOf, currentTurn, inactivityTurns } = ctx
  if (inactivityTurns === 0) return entries
  return entries.filter((entry) => {
    if (entry?.kind !== 'child' || typeof entry.id !== 'string') return true
    const lastContact = turnOf?.get(entry.id)
    if (lastContact === undefined) return true
    return currentTurn - lastContact < inactivityTurns
  })
}
