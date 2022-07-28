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
    const expected = _compareRev(a, b)
    t.same(expected, r) // sanity check

    t.same(Math.sign(compareRev(a, b)), r)
    t.same(Math.sign(compareRev(a && Buffer.from(a), b)), r)
    t.same(Math.sign(compareRev(a, b && Buffer.from(b))), r)
    t.same(Math.sign(compareRev(a && Buffer.from(a), b && Buffer.from(b))), r)
    t.end()
  })
}

const ascii = Array.from({ length: 128 })
  .map((_, index) => String.fromCharCode(index))
  .join('')
const rand = (n) => Math.floor(Math.random() * n)
const randHex = () => ascii[rand(ascii.length)]
const randId = () => Array.from({ length: rand(10e2) }, randHex).join('')
const randRev = () => `${rand(10e3)}-${randId()}`

test('fuzz', (t) => {
  const N = 1e4
  for (let i = 0; i < N; i++) {
    const a = randRev()
    const b = randRev()
    const r = _compareRev(a, b)

    t.test(`${a} ${b} ${r}`, (t) => {
      t.same(Math.sign(compareRev(a, b)), r)
      t.same(Math.sign(compareRev(a && Buffer.from(a), b)), r)
      t.same(Math.sign(compareRev(a, b && Buffer.from(b))), r)
      t.same(Math.sign(compareRev(a && Buffer.from(a), b && Buffer.from(b))), r)
      t.end()
    })
  }
  t.end()
})

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
