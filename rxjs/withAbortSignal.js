const rxjs = require('rxjs')
const { AbortError } = require('../errors')

module.exports = rxjs.Observable.prototype.withAbortSignal = function (signal) {
  return new rxjs.Observable((o) => {
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
