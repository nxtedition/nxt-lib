const amrap = require('./util/amrap')
const compareRev = require('../util/compare-rev')

const ascii = Array.from({ length: 128 })
  .map((_, index) => String.fromCharCode(index))
  .join('')

const rand = (n) => Math.floor(Math.random() * n)
const randHex = () => ascii[rand(ascii.length)]
const randId = () => Array.from({ length: rand(10e2) }, randHex).join('')
const randRev = () => `${rand(10e3)}-${randId()}`

const NUM_CASES = 1e5
const cases = []
for (let i = 0; i < NUM_CASES; i++) {
  const a = randRev()
  const b = randRev()
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  cases.push([a, b, aBuf, bBuf])
}
let caseIndex = 0

const funcs = {
  'optimized(str,str)': () => {
    const c = cases[caseIndex]
    compareRev(c[0], c[1])
    if (++caseIndex === NUM_CASES) {
      caseIndex = 0
    }
  },
  'optimized(buf,buf)': () => {
    const c = cases[caseIndex]
    compareRev(c[2], c[3])
    if (++caseIndex === NUM_CASES) {
      caseIndex = 0
    }
  },
  'optimized(buf,str)': () => {
    const c = cases[caseIndex]
    compareRev(c[2], c[1])
    if (++caseIndex === NUM_CASES) {
      caseIndex = 0
    }
  },
  'original(str,str)': () => {
    const c = cases[caseIndex]
    _compareRev(c[0], c[1])
    if (++caseIndex === NUM_CASES) {
      caseIndex = 0
    }
  },
  'original(buf,buf)': () => {
    const c = cases[caseIndex]
    _compareRev(c[2], c[3])
    if (++caseIndex === NUM_CASES) {
      caseIndex = 0
    }
  },
  'original(buf,str)': () => {
    const c = cases[caseIndex]
    _compareRev(c[2], c[1])
    if (++caseIndex === NUM_CASES) {
      caseIndex = 0
    }
  },
}

const nameColWidth = 20
const repsColWidth = 15

console.log(`${'NAME'.padEnd(nameColWidth)}${'REPS'.padStart(repsColWidth)}`)
console.log('-'.repeat(nameColWidth + repsColWidth))

for (const [name, func] of Object.entries(funcs)) {
  // Warmup
  for (let i = 0; i < NUM_CASES; i++) {
    func()
  }

  // Measure
  const reps = amrap((n) => {
    for (let i = 0; i < n; i++) {
      func()
    }
  }, 1e3)

  // Print
  console.log(`${name.padEnd(nameColWidth)}${reps.toLocaleString().padStart(repsColWidth)}`)
}

function _compareRev(a, b) {
  if (!a) {
    return b ? -1 : 0
  }

  if (!b) {
    return a ? 1 : 0
  }

  a = a.toString('latin1')
  b = b.toString('latin1')

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
