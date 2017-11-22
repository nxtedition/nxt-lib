const { Observable } = require('rxjs')

Observable.prototype.auditMap = function (project) {
  return Observable.create(o => {
    let source = this
    let buffer = []
    let active = 0
    let innerSubscription = null
    let outerSubscription = null

    function _error (err) {
      o.error(err)
    }

    function _innerComplete () {
      active -= 1

      if (active === 0 && buffer.length) {
        _tryNext(buffer.shift())
      }
    }

    function _innerNext (val) {
      o.next(val)
    }

    function _tryNext (value) {
      let result
      try {
        result = project(value)
      } catch (err) {
        o.error(err)
        return
      }

      active += 1

      const observable = typeof result.then === 'function' ? Observable.fromPromise(result) : result
      innerSubscription = observable.subscribe(_innerNext, _error, _innerComplete)
    }

    function _next (value) {
      if (active === 0) {
        _tryNext(value)
      } else {
        buffer = [ value ]
      }
    }

    function _complete () {
      o.complete()
    }

    outerSubscription = source.subscribe(_next, _error, _complete)

    return () => {
      if (innerSubscription) {
        innerSubscription.unsubscribe()
      }
      outerSubscription.unsubscribe()
    }
  })
}
