const { test } = require('tap')
const combineMap = require('../../rxjs/combineMap')
const rxjs = require('rxjs')

test('combineMap sync', (t) => {
  t.plan(1)
  rxjs
    .of([1, 2, 3])
    .pipe(combineMap((val) => rxjs.of(val * 2)))
    .subscribe((val) => {
      t.same(val, [2, 4, 6])
    })
})

test('combineMap async', (t) => {
  t.plan(1)
  rxjs
    .of([1, 2, 3])
    .pipe(combineMap(async (val) => val * 2))
    .subscribe((val) => {
      t.same(val, [2, 4, 6])
    })
})

test('combineMap throw in resolver', (t) => {
  t.plan(1)
  const _err = new Error('asd')
  rxjs
    .of([1, 2, 3])
    .pipe(
      combineMap((val) => {
        throw _err
      })
    )
    .subscribe({
      error: (err) => {
        t.same(err, _err)
      },
    })
})

test('combineMap throw in source', (t) => {
  t.plan(1)
  const _err = new Error('asd')
  rxjs
    .throwError(() => _err)
    .pipe(combineMap((val) => rxjs.of(val)))
    .subscribe({
      error: (err) => {
        t.same(err, _err)
      },
    })
})

test('combineMap bad resolve', (t) => {
  t.plan(1)
  rxjs
    .of([1])
    .pipe(combineMap((val) => val))
    .subscribe({
      error: () => {
        t.pass()
      },
    })
})

test('combineMap no change no tick', (t) => {
  t.plan(1)
  rxjs
    .concat(
      rxjs.timer(10).pipe(rxjs.map(() => [1, 2, 3])),
      rxjs.timer(10).pipe(rxjs.map(() => [1, 2, 3]))
    )
    .pipe(combineMap((val) => rxjs.of(val * 2)))
    .subscribe(() => {
      t.pass()
    })
})

test('combineMap combine in single tick', (t) => {
  t.plan(2)
  rxjs
    .concat(
      rxjs.timer(10).pipe(rxjs.map(() => [1, 2, 3])),
      rxjs.timer(10).pipe(rxjs.map(() => [4, 5, 6]))
    )
    .pipe(combineMap((val) => rxjs.from([val * 2, val * 2])))
    .subscribe(() => {
      t.pass()
    })
})

test('combineLatest completion', (t) => {
  t.plan(1)
  rxjs.combineLatest([1, 2, 3].map((x) => rxjs.of(x))).subscribe({
    complete: () => {
      t.pass()
    },
  })
})

test('combineMap completion', (t) => {
  t.plan(1)
  rxjs
    .of([1, 2, 3])
    .pipe(combineMap((x) => rxjs.of(x)))
    .subscribe({
      complete: () => {
        t.pass()
      },
    })
})

test('combineLatest no completion', (t) => {
  t.plan(1)
  const subscription = rxjs
    .combineLatest([1, 2, 3].map((x) => rxjs.timer(0, 1e3).pipe(rxjs.map(() => x))))
    .subscribe({
      next: () => {
        t.pass()
      },
      complete: () => {
        t.fail()
      },
    })
  t.teardown(() => subscription.unsubscribe())
})

test('combineMap no completion', (t) => {
  t.plan(1)
  const subscription = rxjs
    .of([1, 2, 3])
    .pipe(combineMap((x) => rxjs.timer(0, 1e3).pipe(rxjs.map(() => x))))
    .subscribe({
      next: () => {
        t.pass()
      },
      complete: () => {
        t.fail()
      },
    })
  t.teardown(() => subscription.unsubscribe())
})
