const rxjs = require('rxjs')

function nop() {}

function toGenerator() {
  const observable = this
  return async function* () {
    const buffer = []

    let resolve = nop
    let complete = false
    let error = null

    const subscription = observable.subscribe({
      next: (val) => {
        buffer.push(val)
        resolve()
      },
      error: (err) => {
        error = err
        resolve()
      },
      complete: () => {
        complete = true
        resolve()
      },
    })

    try {
      while (true) {
        if (buffer.length) {
          yield* buffer.splice(0)
        } else if (error) {
          throw error
        } else if (complete) {
          return
        } else {
          /* eslint-disable */
          await new Promise((_resolve) => {
            resolve = _resolve
          })
          /* eslint-enable */
          resolve = nop
        }
      }
    } finally {
      subscription.unsubscribe()
    }
  }
}

rxjs.Observable.prototype.toGenerator = toGenerator

module.exports = (o) => toGenerator.call(o)
