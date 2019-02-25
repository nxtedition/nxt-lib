const { Observable, ReplaySubject } = require('rxjs')

module.exports = function cached (fn, options, keySelector = key => key) {
  const cache = new Map()
  const array = []

  if (Number.isFinite(options)) {
    options = { minAge: options }
  } else if (options == null) {
    options = { minAge: 1000 }
  }

  if (options.minAge === undefined) {
    // NOTE: backwards compat
    options.minAge = options.maxAge !== undefined ? options.maxAge : 1000
  }

  const { minAge } = options

  function prune () {
    let pos = 0
    let end = array.length
    let now = Date.now()

    while (pos < end) {
      const { refs, key, subscription, timestamp } = array[pos]

      if (refs === 0 && timestamp + minAge < now) {
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

  setInterval(prune, minAge)

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
          refs: 0,
          timestamp: null
        }

        cache.set(key, entry)
        array.push(entry)
      }

      entry.refs += 1

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
