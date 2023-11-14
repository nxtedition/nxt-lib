import { test } from 'tap'
import compareRev from '../../util/compare-rev.js'

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
  ['837-N', '5763-/h', -1],
  ['000000837-N', '5763-/h', -1],
  ['1-A', '1-AA', -1],
]

for (const [a, b, r] of cases) {
  test(`${a} ${b} ${r}`, (t) => {
    const expected = _compareRev(a, b)
    if (r != null) {
      t.same(expected, r) // sanity check
      t.same(Math.sign(compareRev(a, b)), r)
    }

    t.same(Math.sign(compareRev(a && Buffer.from(a), b)), expected)
    t.same(Math.sign(compareRev(a, b && Buffer.from(b))), expected)
    t.same(Math.sign(compareRev(a && Buffer.from(a), b && Buffer.from(b))), expected)
    t.end()
  })
}

const ascii = Array.from({ length: 128 })
  .map((_, index) => (index > 27 && index < 127 ? String.fromCharCode(index) : null))
  .filter(Boolean)
  .join('')
const rand = (n) => Math.floor(Math.random() * n)
const randChar = () => ascii[rand(ascii.length)]
const randId = () => Array.from({ length: rand(63) + 1 }, randChar).join('')
const randRev = (other) => {
  const num = other && !rand(3) ? parseInt(other) : rand(10e3)
  let id
  if (other && !rand(3)) {
    id = other.slice(other.indexOf('-') + 1)
    if (rand(3)) {
      id = id.slice(0, rand(id.length - 1) + 1)
    }
  } else {
    id = randId()
  }
  return `${String(num).padStart(rand(10), '0')}-${id}`
}

test('fuzz', (t) => {
  const N = 1e4
  for (let i = 0; i < N; i++) {
    let a = randRev()
    let b = randRev(a)
    if (rand(2)) {
      ;[a, b] = [b, a]
    }
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
