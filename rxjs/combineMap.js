const rxjs = require('rxjs')

const EMPTY = Object.freeze([])

function combineMap(project, equals = (a, b) => a === b) {
  const self = this
  return new rxjs.Observable((o) => {
    let curr = EMPTY
    let scheduled = false
    let disposed = false
    let dirty = false
    let active = 0
    let empty = 0

    const _error = (err) => o.error(err)

    function _update() {
      scheduled = false

      if (empty > 0) {
        return
      }

      if (dirty) {
        dirty = false
        o.next(curr.map(({ value }) => value))
      }

      if (active === 0) {
        o.complete()
      }
    }

    function update() {
      if (!scheduled && !disposed) {
        scheduled = true
        queueMicrotask(_update)
      }
    }

    active += 1
    const subscription = self.subscribe({
      next(keys) {
        keys = Array.isArray(keys) ? keys : EMPTY

        // TODO (perf): Avoid array allocation & copy if nothing has updated.
        const prev = curr
        curr = new Array(keys.length)

        const prevLen = prev.length
        const currLen = curr.length

        if (currLen !== prevLen || prev === EMPTY) {
          dirty = true
        }

        for (let n = 0; n < currLen; ++n) {
          const key = keys[n]

          if (n < prevLen && prev[n] && equals(prev[n].key, key)) {
            curr[n] = prev[n]
            prev[n] = null
            continue
          }

          dirty = true

          // TODO (perf): Guess start index based on n, e.g. n - 1 and n + 1 to check if
          // a key has simply been added or removed.
          const i = prev.findIndex((entry) => entry && equals(entry.key, key))

          if (i !== -1) {
            curr[n] = prev[i]
            prev[i] = null
          } else {
            let observable
            try {
              observable = rxjs.from(project(keys[n]))
            } catch (err) {
              observable = rxjs.throwError(() => err)
            }

            const entry = {
              key,
              value: EMPTY,
              subscription: null,
            }

            empty += 1
            entry.subscription = observable.subscribe({
              next(value) {
                if (entry.value === EMPTY) {
                  empty -= 1
                }

                entry.value = value
                dirty = true

                update()
              },
              error: _error,
            })

            active += 1
            entry.subscription.add(() => {
              active -= 1

              if (entry.value === EMPTY) {
                empty -= 1
              }

              update()
            })

            if (disposed) {
              entry.subscription.unsubscribe()
            } else {
              curr[n] = entry
            }
          }
        }

        // TODO (perf): start from index where prev[n] is not null.
        for (let n = 0; n < prevLen; n++) {
          prev[n]?.subscription?.unsubscribe()
        }

        update()
      },
      complete: () => {
        active -= 1
        update()
      },
      error: _error,
    })

    return () => {
      disposed = true

      for (const entry of curr) {
        entry?.subscription?.unsubscribe()
      }

      subscription.unsubscribe()
    }
  })
}

rxjs.Observable.prototype.combineMap = combineMap

module.exports = (project, equals) => (o) => combineMap.call(o, project, equals)
