const rxjs = require('rxjs')

const EMPTY = {}

function combineMap(project, compare = (a, b) => a === b) {
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

        for (let n = 0; n < len; ++n) {
          const key = keys[n]

          if (n < curr.length && compare(curr[n].key, key)) {
            next[n] = curr[n]
            curr[n] = null
            continue
          }

          updated = true
          update()

          // TODO (perf): Guess start index based on n, e.g. n - 1 and n + 1 to check if
          // a key has simply been added or removed.
          const i = curr.findIndex((context) => context && compare(context.key, key))

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
              error: onError,
            })
            context.subscription.add(() => {
              if (context.value === EMPTY) {
                empty -= 1
              }

              active -= 1

              updated = true
              update()
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

module.exports = (project) => (o) => combineMap.call(o, project)
