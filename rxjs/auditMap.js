const rxjs = require('rxjs')

function auditMap(project) {
  return new rxjs.Observable((o) => {
    let pendingValue = null
    let hasPendingValue = false
    let isComplete = false

    let innerSubscription = null
    let outerSubscription = null

    function _error(err) {
      o.error(err)
    }

    function _innerComplete() {
      innerSubscription = null

      if (hasPendingValue) {
        const value = pendingValue
        pendingValue = null
        hasPendingValue = false
        _tryNext(value)
      } else if (isComplete) {
        o.complete()
      }
    }

    function _innerNext(val) {
      o.next(val)
    }

    function _tryNext(value) {
      try {
        const result = project(value)
        const observable = typeof result.then === 'function' ? rxjs.from(result) : result
        innerSubscription = observable.subscribe({
          next: _innerNext,
          error: _error,
          complete: _innerComplete,
        })
        if (innerSubscription && innerSubscription.closed) {
          innerSubscription = null
        }
      } catch (err) {
        o.error(err)
      }
    }

    function _next(value) {
      if (innerSubscription) {
        pendingValue = value
        hasPendingValue = true
      } else {
        _tryNext(value)
      }
    }

    function _complete() {
      isComplete = true
      if (!innerSubscription) {
        o.complete()
      }
    }

    outerSubscription = this.subscribe({
      next: _next,
      error: _error,
      complete: _complete,
    })

    return () => {
      if (innerSubscription) {
        innerSubscription.unsubscribe()
      }
      outerSubscription.unsubscribe()
    }
  })
}

rxjs.Observable.prototype.auditMap = auditMap

module.exports = (project) => (o) => auditMap.call(o, project)
