const { Observable } = require('rxjs')

module.exports = Observable.prototype.combineMap = function (resolver) {
  return this.switchMap((xs) =>
    Array.isArray(xs) && xs.length > 0
      ? Observable.combineLatest(xs.map(resolver))
      : Observable.of([])
  )
}
