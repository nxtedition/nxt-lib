const rxjs = require('rxjs')

const EMPTY = {}

function combineMap(
  resolver,
  { keyEquals, valueEquals } = {
    keyEquals: (a, b) => a === b,
    valueEquals: (a, b) => a === b,
  }
) {
  const self = this
  return new rxjs.Observable((o) => {
    let curr = []
    let scheduled = false
    let updated = false
    let active = 0
    let empty = 0

    const onError = (err) => o.error(err)

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
      if (!scheduled) {
        scheduled = true
        process.nextTick(_update)
      }
    }

    active += 1
    const subscription = self.subscribe({
      next(xs) {
        // TODO (perf): Avoid array allocation & copy if nothing has updated.

        const prev = curr
        curr = []

        const len = Array.isArray(xs) ? xs.length : 0
        for (let n = 0; n < len; ++n) {
          const key = xs[n]

          if (n < prev.length && keyEquals(prev[n].key, key)) {
            curr.push(prev[n])
            prev[n] = null
            continue
          }

          // TODO (perf): Guess start index based on n, e.g. n - 1 and n + 1 to check if
          // a key has simply been added or removed.
          const idx = prev.findIndex((context) => context && keyEquals(context.key, key))

          if (idx !== -1) {
            curr.push(prev[idx])
            prev[idx] = null
          } else {
            const context = {
              key,
              value: EMPTY,
              subscription: null,
            }

            let observable
            try {
              observable = rxjs.from(resolver(xs[n]))
            } catch (err) {
              observable = rxjs.throwError(() => err)
            }

            active += 1
            empty += 1
            context.subscription = observable.subscribe({
              next(value) {
                if (context.value === EMPTY) {
                  empty -= 1
                } else if (valueEquals && valueEquals(context.value, value)) {
                  return
                }

                context.value = value

                updated = true
                update()
              },
              error: onError,
              complete: () => {
                if (context.value === EMPTY) {
                  empty -= 1
                }

                active -= 1
                if (!active) {
                  update()
                }
              },
            })

            curr.push(context)
          }

          updated = true
          update()
        }

        for (const context of prev) {
          if (context) {
            if (context.value === EMPTY) {
              empty -= 1
            }
            active -= 1
            context.subscription.unsubscribe()

            updated = true
            update()
          }
        }
      },
      error: onError,
      complete() {
        active -= 1
        if (!active) {
          update()
        }
      },
    })

    return () => {
      for (const context of curr) {
        context.subscription.unsubscribe()
      }
      subscription.unsubscribe()
    }
  })
}

rxjs.Observable.prototype.combineMap = combineMap

module.exports = (resolver) => (o) => combineMap.call(o, resolver)
