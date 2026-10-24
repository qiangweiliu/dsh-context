export function createRateLimiter(options) {
  const limit = Number(options?.limit)
  const windowMs = Number(options?.windowMs)
  const now = typeof options?.now === 'function' ? options.now : () => Date.now()
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('limit must be a positive integer')
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new Error('windowMs must be positive')
  const stamps = []
  return {
    tryAcquire() {
      const at = now()
      while (stamps.length > 0 && stamps[0] <= at - windowMs) stamps.shift()
      if (stamps.length < limit) {
        stamps.push(at)
        return { ok: true }
      }
      return { ok: false, retryAfterMs: Math.max(1, stamps[0] + windowMs - at) }
    },
  }
}
