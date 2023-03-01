const rxjs = require('rxjs')

const EMPTY = Object.freeze([])

function combineMap(project, equals = (a, b) => a === b) {
  const self = this
  return new rxjs.Observable((o) => {
    let curr = EMPTY
    let scheduled = false
    let updated = false
    let active = 0
    let empty = 0

    const _error = (err) => o.error(err)

    function _update() {
      scheduled = false

      if (empty) {
        return
      }

      if (updated) {
        updated = false
        o.next(curr.map((context) => context.value))
      }

      if (!active) {
        o.complete()
      }
    }

    function update() {
      if (!scheduled && !empty) {
        scheduled = true
        queueMicrotask(_update)
      }
    }

    active += 1
    const subscription = self.subscribe({
      next(keys) {
        // TODO (perf): Avoid array allocation & copy if nothing has updated.

        const prev = curr
        curr = new Array(Array.isArray(keys) ? keys.length : 0)

        const prevLen = prev.length
        const currLen = curr.length

        if (currLen !== prevLen || prev === EMPTY) {
          updated = true
        }

        for (let n = 0; n < currLen; ++n) {
          const key = keys[n]

          if (n < prevLen && prev[n] && equals(prev[n].key, key)) {
            curr[n] = prev[n]
            prev[n] = null
            continue
          }

          updated = true

          // TODO (perf): Guess start index based on n, e.g. n - 1 and n + 1 to check if
          // a key has simply been added or removed.
          const i = prev.findIndex((context) => context && equals(context.key, key))

          if (i !== -1) {
            curr[n] = prev[i]
            prev[i] = null
          } else {
            const context = (curr[n] = {
              key,
              value: EMPTY,
              subscription: null,
            })

            let observable
            try {
              observable = rxjs.from(project(keys[n]))
            } catch (err) {
              observable = rxjs.throwError(() => err)
            }

            empty += 1
            active += 1
            context.subscription = observable.subscribe({
              next(value) {
                if (context.value === EMPTY) {
                  empty -= 1
                }

                context.value = value

                updated = true
                update()
              },
              error: _error,
            })
            context.subscription.add(() => {
              if (context.value === EMPTY) {
                empty -= 1
              }

              active -= 1

              updated = true
              update()
            })
          }
        }

        if (updated) {
          // TODO (perf): start from index where prev[n] is not null.
          for (let n = 0; n < prevLen; n++) {
            prev[n]?.subscription.unsubscribe()
          }

          update()
        }
      },
      error: _error,
      complete() {
        active -= 1
        if (!active) {
          update()
        }
      },
    })

    return () => {
      for (const context of curr) {
        context?.subscription.unsubscribe()
      }
      subscription.unsubscribe()
    }
  })
}

rxjs.Observable.prototype.combineMap = combineMap

module.exports = (project, equals) => (o) => combineMap.call(o, project, equals)
