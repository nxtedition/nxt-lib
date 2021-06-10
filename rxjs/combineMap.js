const rxjs = require('rxjs')
const rx = require('rxjs/operators')

function combineMap(resolver) {
  return this.pipe(
    rx.switchMap((xs) =>
      Array.isArray(xs) && xs.length > 0 ? rxjs.combineLatest(xs.map(resolver)) : rxjs.of([])
    )
  )
}

rxjs.Observable.prototype.combineMap = combineMap

module.exports = (resolver) => (o) => combineMap.call(o, resolver)
