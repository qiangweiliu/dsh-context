/**
 * 压缩范围规划（`compactRegion` 选哪一段历史）。
 *
 * 0.41.0 从 control.js 抽出：原实现里只有「事件类型查询」是对 agent 的调用，
 * 其余全是阈值数学。把类型查询改成注入后，这段逻辑就能用假数据穷举边界
 * （keepFloor 取整、可压不足、最小 2 节点、最小 token 阈值），
 * 而这些以前只能靠构造真实会话 + 观察压缩结果来验证。
 *
 * 返回 `{ start, end, tokens }`（首尾 seq + 覆盖 token 数），或 `null` 表示不可压。
 */

/**
 * @param {{
 *   nodes: Array<{ seq: number, tokens?: number, heuristicTokens?: number }>,
 *   totalTokens: number,
 *   budget: number,
 *   target: number,
 *   keepTokens?: number,
 *   defaultKeepTokens?: number,
 *   typeOf?: (node: any) => string | undefined,
 * }} input
 */
export function planRegion(input) {
  const {
    nodes: rawNodes,
    totalTokens,
    budget,
    target,
    keepTokens = 0,
    defaultKeepTokens = 0,
    typeOf = () => undefined,
  } = input ?? {}

  const nodes = Array.isArray(rawNodes) ? rawNodes : []
  const tokensOf = (node) => Number(node?.tokens ?? node?.heuristicTokens ?? 0)

  // 跳过 system（第 0 个），只压较早的 user/assistant 消息（tool 结果也属于可压历史）。
  const messageNodes = nodes.filter((node, index) => {
    if (index === 0) return false
    const type = typeOf(node)
    if (type === undefined) return true
    return type === 'user/message' || type === 'assistant/message' || type === 'tool/result'
  })
  if (messageNodes.length < 2) return null

  const keepFloor = Number(keepTokens) > 0
    ? Number(keepTokens)
    : Number(defaultKeepTokens) > 0
      ? Number(defaultKeepTokens)
      : Math.max(1, Math.floor(budget * 0.25))

  // 最近 keepFloor tokens 作为「不动区」，只在它之前选可压范围。
  let reserve = 0
  let keepFrom = messageNodes.length
  let floorMet = false
  for (let index = messageNodes.length - 1; index >= 0; index -= 1) {
    reserve += tokensOf(messageNodes[index])
    if (reserve >= keepFloor) {
      keepFrom = index
      floorMet = true
      break
    }
  }
  if (!floorMet) return null

  const candidates = messageNodes.slice(0, keepFrom)
  if (candidates.length < 2) return null

  const needed = Math.max(0, Number(totalTokens) - Number(target))
  let accumulated = 0
  let cut = 0
  for (let index = 0; index < candidates.length; index += 1) {
    accumulated += tokensOf(candidates[index])
    if (accumulated >= needed) {
      cut = index + 1
      break
    }
  }
  // 可压历史不够达到 target：只压能压的部分（仍受 keepFloor 限制）。
  if (cut === 0) cut = candidates.length
  // compactRegion 至少要覆盖 2 个节点，避免把单条消息切碎。
  cut = Math.max(2, cut)
  const selected = candidates.slice(0, Math.min(cut, candidates.length))
  if (selected.length < 2) return null
  const selectedTokens = selected.reduce((sum, node) => sum + tokensOf(node), 0)
  if (selectedTokens < Math.max(200, Math.min(keepFloor, needed))) return null
  return { start: selected[0].seq, end: selected[selected.length - 1].seq, tokens: selectedTokens }
}
