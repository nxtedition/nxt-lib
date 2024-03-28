import assert from 'node:assert'

export function makeLimiter(limit) {
  assert(Number.isFinite(limit), 'invalid limit')

  const limiter = {
    limit,
    tokens: limit,
    /** @type Array<{ callback: Function, count: number }> */
    pending: [],
    consume(count, callback) {
      assert(count <= this.limit, 'invalid count')
      assert(callback == null || typeof callback === 'function', 'invalid callback')

      let promise
      if (!callback) {
        promise = new Promise((resolve) => {
          callback = resolve
        })
      }
      this.tokens -= count
      if (this.tokens >= 0) {
        callback(null, null)
      } else {
        this.pending.push({ callback, count: -this.tokens })
        this.tokens = 0
      }
      return promise
    },
  }

  setInterval(() => {
    limiter.tokens = limiter.limit
    for (const { callback, count } of limiter.pending.splice(0)) {
      limiter.consume(count, callback)
    }
  }, 1e3).unref()

  return limiter
}
