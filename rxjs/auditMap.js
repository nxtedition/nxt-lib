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
      --active
      if (buffer.length > 0) {
        _next(buffer.shift())
      }
    }

    function _innerNext (val) {
      o.next(val)
    }

    function _innerSub (result) {
      result = typeof result.then === 'function' ? Observable.fromPromise(result) : result
      innerSubscription = result.subscribe(_innerNext, _error, _innerComplete)
    }

    function _tryNext (value) {
      let result
      try {
        result = project(value)
      } catch (err) {
        o.error(err)
        return
      }
      active++

      _innerSub(result)
    }

    function _next (value) {
      if (active > 0) {
        buffer = [ value ]
      } else {
        _tryNext(value)
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
