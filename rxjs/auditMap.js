const { Observable } = require('rxjs')

Observable.prototype.auditMap = function (project) {
  return Observable.create(o => {
    let source = this
    let buffer = []
    let active = 0

    function _innerSub (result) {
      // TODO Works only with Promise
      result
        .then(val => {
          --active
          o.next(val)
          if (buffer.length > 0) {
            _next(buffer.shift())
          }
        })
        .catch(err => o.error(err))
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

    return source.subscribe(
      _next,
      err => o.error(err),
      () => o.complete()
    )
  })
}
