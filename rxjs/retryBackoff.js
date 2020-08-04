const { Observable } = require('rxjs')

module.exports = Observable.prototype.retryBackoff = function retryBackoff (config) {
  const {
    initialInterval,
    maxAttempts = Infinity,
    maxInterval = Infinity,
    shouldRetry = () => true,
    backoffDelay = (attempt, initialInterval) => Math.pow(2, attempt) * initialInterval,
    tap
  } = (typeof config === 'number') ? { initialInterval: config } : config

  return Observable.create(o => {
    let attempt = 0
    let timeout = null
    let subscription = null

    const _subscribe = () => {
      timeout = null
      subscription = this.subscribe(
        val => {
          attempt = 0
          o.next(val)
        },
        err => {
          attempt++

          if (tap) {
            tap(err, attempt)
          }

          if (attempt < maxAttempts && shouldRetry(err)) {
            const delay = backoffDelay(attempt, initialInterval)
            timeout = setTimeout(_subscribe, Math.min(delay, maxInterval))
          } else {
            o.error(err)
          }
        },
        () => o.complete()
      )
    }

    _subscribe()

    return () => {
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      if (subscription) {
        subscription.unsubscribe()
        subscription = null
      }
    }
  })
}
