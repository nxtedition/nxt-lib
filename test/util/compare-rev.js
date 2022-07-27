const { test } = require('tap')
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
  test(`${a} ${b} ${r}`, (t) => {
    t.same(compareRev(a, b), r)
    t.same(compareRev(a && Buffer.from(a), b), r)
    t.same(compareRev(a, b && Buffer.from(b)), r)
    t.same(compareRev(a && Buffer.from(a), b && Buffer.from(b)), r)
    t.same(compareRev(a, b), _compareRev(a?.toString(), b?.toString()))
    t.same(compareRev(a && Buffer.from(a), b), _compareRev(a?.toString(), b?.toString()))
    t.same(compareRev(a, b && Buffer.from(b)), _compareRev(a?.toString(), b?.toString()))
    t.same(
      compareRev(a && Buffer.from(a), b && Buffer.from(b)),
      _compareRev(a?.toString(), b?.toString())
    )
    t.end()
  })
}

function _compareRev(a, b) {
  if (!a) {
    return b ? -1 : 0
  }

  if (!b) {
    return a ? 1 : 0
  }

  if (a === b) {
    return 0
  }

  const av = a[0] === 'I' ? Infinity : parseInt(a)
  const bv = b[0] === 'I' ? Infinity : parseInt(b)

  if (av !== bv) {
    return av > bv ? 1 : -1
  }

  const ar = a.slice(a.indexOf('-') + 1)
  const br = b.slice(b.indexOf('-') + 1)

  if (ar !== br) {
    return ar > br ? 1 : -1
  }

  return 0
}
