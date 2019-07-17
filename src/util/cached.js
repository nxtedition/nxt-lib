const { Observable, ReplaySubject } = require('rxjs')

module.exports = function cached (fn, options, keySelector) {
  const cache = new Map()
  const array = []

  if (!keySelector) {
    keySelector = options.keySelector || (key => key)
  }

  if (Number.isFinite(options)) {
    options = { maxAge: options }
  } else if (options == null) {
    options = { maxAge: 1000 }
  }

  const maxCount = options.maxCount
  let maxAge = options.maxAge

  if (maxAge === undefined) {
    // NOTE: backwards compat
    maxAge = options.minAge !== undefined ? options.minAge : 1000
  }

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

  setInterval(prune, maxAge)

  return function (...args) {
    const key = keySelector(...args)

    return Observable.create(o => {
      let entry = cache.get(key)

      if (!entry) {
        const observable = new ReplaySubject(1)
        entry = {
          key,
          observable,
          subscription: fn(...args).subscribe(observable),
          refs: 1,
          timestamp: null
        }

        cache.set(key, entry)
      } else {
        if (entry.refs === 0) {
          const idx = array.indexOf(entry)
          if (idx !== -1) {
            array.splice(idx, 1)
          }
        }
        entry.refs += 1
      }

      const subscription = entry.observable.subscribe(o)

      return () => {
        entry.refs -= 1
        if (entry.refs === 0) {
          entry.timestamp = Date.now()
          array.push(entry)

          if (maxCount && array.length > maxCount) {
            const { key, subscription } = array.shift()
            subscription.unsubscribe()
            cache.delete(key)
          }
        }
        subscription.unsubscribe()
      }
    })
  }
}
