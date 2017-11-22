const { Observable } = require('rxjs')

Observable.prototype.auditMap = function (project) {
  return Observable.create(o => {
    let pending = null
    let innerSubscription = null
    let outerSubscription = null

    function _error (err) {
      o.error(err)
    }

    function _innerComplete () {
      innerSubscription = null

      if (pending) {
        pending = null
        _tryNext(pending)
      }
    }

    function _innerNext (val) {
      o.next(val)
    }

    function _tryNext (value) {
      try {
        const result = project(value)
        const observable = typeof result.then === 'function' ? Observable.fromPromise(result) : result
        innerSubscription = observable.subscribe(_innerNext, _error, _innerComplete)
      } catch (err) {
        o.error(err)
      }
    }

    function _next (value) {
      if (innerSubscription) {
        pending = value
      } else {
        _tryNext(value)
      }
    }

    function _complete () {
      o.complete()
    }

    outerSubscription = this.subscribe(_next, _error, _complete)

    return () => {
      if (innerSubscription) {
        innerSubscription.unsubscribe()
      }
      outerSubscription.unsubscribe()
    }
  })
}
