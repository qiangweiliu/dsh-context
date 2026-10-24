export class LRU {
  #capacity
  #map
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new Error('capacity must be positive')
    this.#capacity = capacity
    this.#map = new Map()
  }
  get size() { return this.#map.size }
  get(key) {
    if (!this.#map.has(key)) return undefined
    const value = this.#map.get(key)
    this.#map.delete(key)
    this.#map.set(key, value)
    return value
  }
  set(key, value) {
    if (this.#map.has(key)) this.#map.delete(key)
    this.#map.set(key, value)
    while (this.#map.size > this.#capacity) this.#map.delete(this.#map.keys().next().value)
    return this
  }
}
