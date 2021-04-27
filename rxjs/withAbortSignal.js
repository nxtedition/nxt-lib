const { Observable } = require('rxjs')
const { AbortError } = require('../errors')

module.exports = Observable.prototype.withAbortSignal = function (signal) {
  return new Observable((o) => {
    if (signal.aborted) {
      o.error(new AbortError())
      return
    }
    const abort = () => o.error(new AbortError())
    signal.addEventListener('abort', abort)
    const subscription = this.subscribe(o)
    return () => {
      signal.removeEventListener('abort', abort)
      subscription.unsubscribe()
    }
  })
}
