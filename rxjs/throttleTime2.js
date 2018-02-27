const { Observable } = require('rxjs')

Observable.prototype.throttleTime2 = function throttleTime2 (duration) {
  return Observable.create(o => {
    let hasFirst
    let nextValue
    let timeout

    const subscription = this.subscribe({
      next: value => {
        if (!hasFirst) {
          hasFirst = true
          o.next(value)
        } else {
          nextValue = value
          timeout = timeout || setTimeout(() => {
            o.next(nextValue)
            timeout = null
          }, duration)
        }
      },
      error: err => o.error(err),
      complete: () => {
        if (timeout) {
          clearTimeout(timeout)
          o.next(nextValue)
        }
        o.complete()
      }
    })
    return () => subscription.unsubscribe()
  })
}
