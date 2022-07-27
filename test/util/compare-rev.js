const tap = require('tap')
const { compareRev } = require('../../util')

const cases = [
  [null, null, 0],
  [null, '1-00000000000000', -1],
  ['1-00000000000000', null, 1],
  ['INF-00000000000000', '1-00000000000000', 1],
  ['1-00000000000000', 'INF-00000000000000', -1],
  ['INF-00000000000000', 'INF-00000000000000', 0],
  ['INF-00000000000001', 'INF-00000000000000', 1],
  ['INF-00000000000001', 'INF-00000000000002', -1],
  ['1-00000000000000', '1-00000000000000', 0],
  ['1-00000000000000', '1-00000000000001', -1],
  ['1-00000000000001', '1-00000000000000', 1],
  ['1-00000000000000', '2-00000000000000', -1],
  ['2-00000000000000', '1-00000000000000', 1],
  ['1-00000000000000', '02-00000000000000', -1],
  ['02-00000000000000', '1-00000000000000', 1],
  ['01-00000000000000', '02-00000000000000', -1],
  ['02-00000000000000', '01-00000000000000', 1],
  ['11-00000000000000', '2-00000000000000', 1],
  ['2-00000000000000', '11-00000000000000', -1],
]

for (const [a, b, r] of cases) {
  tap.same(compareRev(a, b), r)
  tap.same(compareRev(a && Buffer.from(a), b), r)
  tap.same(compareRev(a, b && Buffer.from(b)), r)
  tap.same(compareRev(a && Buffer.from(a), b && Buffer.from(b)), r)
}
