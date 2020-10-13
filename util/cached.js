const { Observable, ReplaySubject } = require('rxjs')

const STATS = {}

module.exports = function cached (fn, options, keySelector) {
  const name = fn.name
  const cache = new Map()
  const array = []

  if (Number.isFinite(options)) {
    options = { maxAge: options }
  } else if (options == null) {
    options = { maxAge: 1000 }
  }

  if (!keySelector) {
    keySelector = options.keySelector || (key => key)
  }

  let maxAge = options.maxAge

  if (maxAge === undefined) {
    // NOTE: backwards compat
    maxAge = options.minAge !== undefined ? options.minAge : 1000
  }

  const buffer = options.buffer ? options.buffer : 1

  function prune () {
    const end = array.length
    const now = Date.now()

    let idx = 0

    while (idx < end) {
      const age = now - array[idx].timestamp
      if (age < maxAge) {
        break
      }

      const { key, subscription } = array[idx]
      subscription.unsubscribe()
      cache.delete(key)

      idx += 1
    }

    array.splice(0, idx)
  }

  if (maxAge) {
    setInterval(prune, maxAge)
  }

  return function (...args) {
    const key = keySelector(...args)

    return new Observable(o => {
      let entry = cache.get(key)

      if (!entry) {
        const observable = new ReplaySubject(buffer)
        entry = {
          key,
          observable,
          subscription: fn(...args).subscribe(observable),
          refs: 0,
          timestamp: null
        }

        cache.set(key, entry)
      } else if (maxAge) {
        if (entry.refs === 0) {
          const idx = array.indexOf(entry)
          if (idx !== -1) {
            array.splice(idx, 1)
          }
        }
      }
      entry.refs += 1

      if (name) {
        STATS[name] = (STATS[name] || 0) + 1
      }

      const subscription = entry.observable.subscribe(o)

      return () => {
        if (name) {
          STATS[name] = (STATS[name] || 0) - 1
          if (!STATS[name]) {
            delete STATS[name]
          }
        }

        entry.refs -= 1
        if (entry.refs === 0) {
          if (!maxAge || entry.observable.hasError) {
            const { key, subscription } = entry
            subscription.unsubscribe()
            cache.delete(key)
          } else {
            entry.timestamp = Date.now()
            array.push(entry)
          }
        }
        subscription.unsubscribe()
      }
    })
  }
}

module.exports.STATS = STATS
