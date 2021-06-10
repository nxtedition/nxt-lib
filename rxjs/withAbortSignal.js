const rxjs = require('rxjs')
const { AbortError } = require('../errors')

function withAbortSignal(signal) {
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

rxjs.Observable.prototype.withAbortSignal = withAbortSignal

module.exports = (signal) => (o) => withAbortSignal.call(o, signal)
