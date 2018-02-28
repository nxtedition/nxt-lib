const { Observable } = require('rxjs')

Observable.prototype.throttleTime2 = function throttleTime2 (duration) {
  return Observable.create(o => {
    let interval
    let nextValue
    let hasNextValue = false

    const subscription = this.subscribe({
      next: value => {
        if (!interval) {
          o.next(value)
          interval = setInterval(() => {
            if (hasNextValue) {
              o.next(nextValue)
              hasNextValue = false
            } else {
              clearInterval(interval)
              interval = null
            }
          }, duration)
        } else {
          nextValue = value
          hasNextValue = true
        }
      },
      error: err => o.error(err),
      complete: () => {
        if (interval) {
          clearTimeout(interval)
          interval = null
        }
        if (hasNextValue) {
          o.next(nextValue)
          hasNextValue = false
        }
        o.complete()
      }
    })
    return () => subscription.unsubscribe()
  })
}
