const { test } = require('tap')
const combineMap = require('../../rxjs/combineMap')
const rxjs = require('rxjs')

test('combineMap', (t) => {
  t.plan(1)
  rxjs
    .of([1, 2, 3])
    .pipe(combineMap((val) => rxjs.of(val)))
    .subscribe((val) => {
      t.same(val, [1, 2, 3])
    })
})
