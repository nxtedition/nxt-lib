const rxjs = require('rxjs')

const registry = new FinalizationRegistry(({ interval, array }) => {
  clearInterval(interval)
  for (const entry of array) {
    entry?.subscription?.unsubscribe()
  }
})

module.exports = function cached(fn, options, keySelector) {
  if (Number.isFinite(options)) {
    options = { maxAge: options }
  } else if (options == null) {
    options = { maxAge: 1e3 }
  }

  if (!keySelector) {
    keySelector = options.keySelector || ((key) => key)
  }

  let maxAge = options.maxAge

  if (maxAge === undefined) {
    // NOTE: backwards compat
    maxAge = options.minAge !== undefined ? options.minAge : 1e3
  } else if (maxAge === null) {
    maxAge = 0
  }

  if (!Number.isFinite(maxAge) || maxAge < 0) {
    throw new Error('invalid maxAge')
  }

  const bufferSize = options.buffer ? options.buffer : 1
  const cache = new Map()
  const array = []

  let fastNow = Date.now()
  let interval

  if (maxAge) {
    interval = setInterval(() => {
      fastNow = Date.now()

      const end = Math.max(1024, array.length / 100)

      let idx
      for (idx = 0; idx < end; ++idx) {
        const entry = array[idx]

        if (!entry || entry.refs > 0) {
          continue
        }

        const age = fastNow - entry.timestamp
        if (age < maxAge) {
          break
        }

        entry.subscription.unsubscribe()
      }

      array.splice(0, idx)
    }, 1e3).unref()
  }

  const getter = function (...args) {
    const key = keySelector(...args)

    return new rxjs.Observable((o) => {
      let entry = cache.get(key)

      if (!entry) {
        const observable = bufferSize ? new rxjs.ReplaySubject(bufferSize) : rxjs.Subject()

        entry = {
          observable,
          subscription: fn(...args).subscribe(observable),
          refs: 0,
          timestamp: null,
        }

        entry.subscription.add(() => cache.delete(key))

        cache.set(key, entry)
      }

      entry.refs += 1
      const subscription = entry.observable.subscribe(o)
      return () => {
        entry.refs -= 1
        subscription.unsubscribe()

        if (entry.refs === 0) {
          if (maxAge) {
            entry.timestamp = fastNow
            array.push(entry)
          } else {
            entry.subscription.unsubscribe()
          }
        }
      }
    })
  }

  registry.register(getter, { interval, array })

  return getter
}
