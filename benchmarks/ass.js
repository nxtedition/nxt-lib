const amrap = require('./util/amrap')

const NUM_CASES = 1e5
const cases = []
for (let i = 0; i < NUM_CASES; i++) {
  cases.push(3600 + i)
}
let caseIndex = 0

function pad0(rep, x) {
  return String(x || 0).padStart(rep, '0')
}

function formatASSTime(seconds) {
  if (seconds == null) {
    return ''
  }
  const h = Math.floor(seconds / 3600)
  seconds -= h * 3600
  const m = Math.floor(seconds / 60)
  seconds -= m * 60
  const s = Math.floor(seconds)
  const cs = Math.floor((seconds - s) * 100)
  return `${pad0(1, h)}:${pad0(2, m)}:${pad0(2, s)}.${pad0(2, cs)}`
}

function formatASSTimeNew(seconds) {
  if (seconds == null) {
    return ''
  }

  const h = Math.floor(seconds / 3600)
  seconds -= h * 3600
  const m = Math.floor(seconds / 60)
  seconds -= m * 60
  const s = Math.floor(seconds)
  const cs = Math.floor((seconds - s) * 100)

  return (
    h +
    ':' +
    (m === 0 ? '00' : m < 10 ? '0' + m : m) +
    ':' +
    (s === 0 ? '00' : s < 10 ? '0' + s : s) +
    ':' +
    (cs === 0 ? '00' : cs < 10 ? '0' + cs : cs) +
    ':'
  )
}

const funcs = {
  formatASSTimeOld: () => {
    const c = cases[caseIndex]
    formatASSTime(c)
    if (++caseIndex === NUM_CASES) {
      caseIndex = 0
    }
  },
  formatASSTimeNew: () => {
    const c = cases[caseIndex]
    formatASSTimeNew(c)
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
