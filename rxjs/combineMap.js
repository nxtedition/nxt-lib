const rxjs = require('rxjs')

const EMPTY = {}
const EQUALS = (a, b) => a === b

function combineMap(resolver, { keyEquals = EQUALS, valueEquals = EQUALS, useMap = null } = {}) {
  const self = this
  return new rxjs.Observable((o) => {
    let curr = []
    let map = useMap ? new Map() : null
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
      if (!scheduled && !empty) {
        scheduled = true
        process.nextTick(_update)
      }
    }

    active += 1
    const subscription = self.subscribe({
      next(keys) {
        // TODO (perf): Avoid array allocation & copy if nothing has updated.

        const len = Array.isArray(keys) ? keys.length : 0
        const next = new Array(len)

        if (useMap == null && !map && len > 1024) {
          map = new Map()
          for (const context of curr) {
            map.set(context.key, context)
          }
        }

        for (let n = 0; n < len; ++n) {
          const key = keys[n]

          if (n < curr.length && keyEquals(curr[n].key, key)) {
            next[n] = curr[n]
            curr[n] = null
            continue
          }

          updated = true
          update()

          // TODO (perf): Guess start index based on n, e.g. n - 1 and n + 1 to check if
          // a key has simply been added or removed.
          const i =
            map?.get(key) ?? curr.findIndex((context, i) => context && keyEquals(context.key, key))

          if (i !== -1) {
            next[n] = curr[i]
            curr[i] = null
          } else {
            const context = {
              key,
              value: EMPTY,
              subscription: null,
            }

            let observable
            try {
              observable = rxjs.from(resolver(keys[n]))
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

                map?.set(context.key, context)
              },
              error: onError,
            })
            context.subscription.add(() => {
              if (context.value === EMPTY) {
                empty -= 1
              }
              active -= 1

              updated = true
              update()

              map?.delete(context.key)
            })

            next[n] = context
          }
        }

        for (const context of curr) {
          context?.subscription.unsubscribe()
        }

        curr = next
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
