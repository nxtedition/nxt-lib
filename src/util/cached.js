const { Observable, ReplaySubject } = require('rxjs')

module.exports = function cached (fn, options, keySelector = key => key) {
  const cache = new Map()
  const array = []

  if (Number.isFinite(options)) {
    options = { maxAge: options }
  } else if (options == null) {
    options = { maxAge: 1000 }
  }

  if (options.maxAge === undefined) {
    // NOTE: backwards compat
    options.maxAge = options.minAge !== undefined ? options.minAge : 1000
  }

  const { maxAge } = options

  function prune () {
    let pos = 0
    let end = array.length
    let now = Date.now()

    while (pos < end) {
      const { refs, key, subscription, timestamp } = array[pos]

      if (refs === 0 && now - timestamp > maxAge) {
        end -= 1
        subscription.unsubscribe()
        array[pos] = array[end]
        cache.delete(key)
      } else {
        pos += 1
      }
    }
    array.length = end
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
        array.push(entry)

        if (options.maxCount && array.length > options.maxCount) {
          const idx = array.findIndex(entry => entry.refs === 0)
          if (idx !== -1) {
            const { key, subscription } = array[idx]
            array[idx] = array.pop()
            subscription.unsubscribe()
            cache.delete(key)
          }
        }
      } else {
        entry.refs += 1
      }

      const subscription = entry.observable.subscribe(o)

      return () => {
        entry.refs -= 1
        if (entry.refs === 0) {
          entry.timestamp = Date.now()
        }
        subscription.unsubscribe()
      }
    })
  }
}
