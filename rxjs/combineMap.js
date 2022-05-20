const rxjs = require('rxjs')

function combineMap(resolver) {
  const self = this
  return new rxjs.Observable((o) => {
    let curr = []
    let scheduled = false
    let changed = false
    let completed = false

    const onError = (err) => o.error(err)

    function _update() {
      if (!scheduled) {
        return
      }

      scheduled = false

      if (changed) {
        changed = false

        const len = curr.length
        const values = new Array(len)

        for (let n = 0; n < len; ++n) {
          const context = curr[n]
          if (!context.hasValue) {
            return
          }
          values[n] = context.value
        }

        o.next(values)
      }

      if (completed) {
        o.complete()
      }
    }

    function update() {
      if (scheduled === false) {
        scheduled = true
        process.nextTick(_update)
      }
    }

    const subscription = self.subscribe({
      next(xs) {
        // TODO (perf): Avoid array allocation & copy if nothing has changed.

        const prev = curr
        curr = []

        const len = Array.isArray(xs) ? xs.length : 0
        for (let n = 0; n < len; ++n) {
          const key = xs[n]

          if (n < prev.length && prev[n].key === key) {
            curr.push(prev[n])
            prev[n] = null
          } else {
            // TODO (perf): Guess start index based on n, e.g. n - 1 and n + 1 to check if
            // a key has simply been added or removed.
            const idx = prev.findIndex((context) => context?.key === key)

            if (idx !== -1) {
              curr.push(prev[idx])
              prev[idx] = null
            } else {
              const context = {
                key,
                value: null,
                hasValue: false,
                subscription: null,
              }

              let observable
              try {
                observable = rxjs.from(resolver(xs[n]))
              } catch (err) {
                observable = rxjs.throwError(() => err)
              }

              context.subscription = observable.subscribe({
                next(val) {
                  context.value = val
                  context.hasValue = true

                  changed = true
                  update()
                },
                error: onError,
              })

              curr.push(context)
            }

            changed = true
            update()
          }
        }

        for (const context of prev) {
          if (context) {
            context.subscription.unsubscribe()

            changed = true
            update()
          }
        }
      },
      error: onError,
      complete() {
        completed = true
        update()
      },
    })

    return () => {
      scheduled = null
      for (const context of curr) {
        context.subscription.unsubscribe()
      }
      subscription.unsubscribe()
    }
  })
}

rxjs.Observable.prototype.combineMap = combineMap

module.exports = (resolver) => (o) => combineMap.call(o, resolver)
