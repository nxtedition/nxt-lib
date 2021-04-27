const { Observable } = require('rxjs')

function nop() {}

module.exports = Observable.prototype.toGenerator = function () {
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
          await new Promise((_resolve) => {
            // eslint-disable-line
            resolve = _resolve
          })
          resolve = nop
        }
      }
    } finally {
      subscription.unsubscribe()
    }
  }
}
