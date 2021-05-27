const rxjs = require('rxjs')
const rx = require('rxjs/operators')

module.exports = rxjs.Observable.prototype.combineMap = function (resolver) {
  return this.pipe(
    rx.switchMap((xs) =>
      Array.isArray(xs) && xs.length > 0 ? rxjs.combineLatest(xs.map(resolver)) : rxjs.of([])
    )
  )
}
