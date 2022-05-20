const rxjs = require('rxjs')

function combineMap(resolver) {
  const self = this
  return new rxjs.Observable((o) => {
    let curr = []
    let updating = false

    const onError = (err) => o.error(err)

    function _update() {
      if (updating) {
        updating = false

        const values = []
        for (const { value, hasValue } of curr) {
          if (!hasValue) {
            return
          }
          values.push(value)
        }

        o.next(values)
      }
    }

    function update() {
      if (updating === false) {
        updating = true
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
                observable = resolver(xs[n])
                if (!rxjs.isObservable(observable)) {
                  throw new Error('expected observable')
                }
              } catch (err) {
                observable = rxjs.throwError(() => err)
              }

              context.subscription = observable.subscribe({
                next(val) {
                  context.value = val
                  context.hasValue = true
                  update()
                },
                error: onError,
              })
              curr.push(context)
            }

            update()
          }
        }

        for (const context of prev) {
          if (context) {
            context.subscription.unsubscribe()
            update()
          }
        }
      },
      error: onError,
      complete() {
        _update()
        o.complete()
      },
    })

    return () => {
      updating = null
      for (const context of curr) {
        context.subscription.unsubscribe()
      }
      subscription.unsubscribe()
    }
  })
}

rxjs.Observable.prototype.combineMap = combineMap

module.exports = (resolver) => (o) => combineMap.call(o, resolver)
