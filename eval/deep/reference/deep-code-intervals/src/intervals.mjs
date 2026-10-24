export function mergeIntervals(intervals) {
  if (!Array.isArray(intervals)) throw new TypeError('intervals must be an array')
  const sorted = intervals.map((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error('interval must be [start, end]')
    const [start, end] = pair
    if (!Number.isInteger(start) || !Number.isInteger(end)) throw new Error('bounds must be integers')
    if (start > end) throw new Error('start must not exceed end')
    return [start, end]
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged = []
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}
