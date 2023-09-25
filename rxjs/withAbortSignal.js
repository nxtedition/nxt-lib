const rxjs = require('rxjs')
const { AbortError } = require('../errors')

function withAbortSignal(signal) {
  return new rxjs.Observable((o) => {
    o.add(this.subscribe(o))

    if (!signal) {
      return
    }

    const onAbort = () => {
      o.error(signal.reason ?? new AbortError())
    }

    if (signal.aborted) {
      onAbort()
    } else {
      signal.addEventListener('abort', onAbort)
      o.add(() => {
        signal.removeEventListener('abort', onAbort)
      })
    }
  })
}

rxjs.Observable.prototype.withAbortSignal = withAbortSignal

module.exports = (signal) => (o) => withAbortSignal.call(o, signal)
