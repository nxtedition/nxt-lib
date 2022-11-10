const amrap = require('./util/amrap')
const assert = require('node:assert')

const NUM_CASES = 1e5
const cases = []
for (let i = 0; i < NUM_CASES; i++) {
  cases.push(i)
}
let caseIndex = 0

const arrayBuffer = new ArrayBuffer(NUM_CASES * 4)
const buffer = Buffer.from(arrayBuffer)
const buffer32 = new Int32Array(arrayBuffer)

const funcs = {
  Buffer: () => {
    const c = cases[caseIndex]
    buffer.writeInt32LE(c, caseIndex * 4)
    assert(buffer.readInt32LE(caseIndex * 4) === c)
    if (++caseIndex === NUM_CASES) {
      caseIndex = 0
    }
  },
  Int32Array: () => {
    const c = cases[caseIndex]
    buffer32[caseIndex] = c
    assert(buffer32[caseIndex] === c)
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
