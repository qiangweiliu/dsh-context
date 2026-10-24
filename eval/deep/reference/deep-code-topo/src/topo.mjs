export function topoSort(nodes, edges) {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new TypeError('nodes and edges must be arrays')
  if (new Set(nodes).size !== nodes.length) throw new Error('duplicate node')
  const known = new Set(nodes)
  const indegree = new Map(nodes.map((node) => [node, 0]))
  const outgoing = new Map(nodes.map((node) => [node, []]))
  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2) throw new Error('edge must be [from, to]')
    const [from, to] = edge
    if (!known.has(from) || !known.has(to)) throw new Error('unknown node in edge')
    outgoing.get(from).push(to)
    indegree.set(to, indegree.get(to) + 1)
  }
  const ready = nodes.filter((node) => indegree.get(node) === 0).sort()
  const order = []
  while (ready.length > 0) {
    const node = ready.shift()
    order.push(node)
    for (const next of outgoing.get(node).sort()) {
      indegree.set(next, indegree.get(next) - 1)
      if (indegree.get(next) === 0) {
        ready.push(next)
        ready.sort()
      }
    }
  }
  if (order.length !== nodes.length) throw new Error('cycle detected')
  return order
}
