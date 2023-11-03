const amrap = require('./util/amrap')

const mergeRanges = require('../merge-ranges')

const NUM_CASES = 1e5
const cases = []
for (let i = 0; i < NUM_CASES; i++) {
  cases.push(i)
}

const ranges1 = [
  [1, 2],
  [3, 5],
  [1, 9],
  [9, 10],
]
const ranges2 = []
const ranges3 = [[1, 2]]

const funcs = {
  new1: () => mergeRanges(ranges1),
  new2: () => mergeRanges(ranges2),
  new3: () => mergeRanges(ranges3),
  old1: () => oldMergeRanges(ranges1),
  old2: () => oldMergeRanges(ranges2),
  old3: () => oldMergeRanges(ranges3),
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

function oldMergeRanges(ranges) {
  if (!Array.isArray(ranges)) {
    return []
  }

  const stack = []

  ranges = ranges
    .filter((range) => range && range.length > 0 && range[1] > range[0])
    .sort((a, b) => a[0] - b[0])

  if (!ranges.length) {
    return []
  }

  ranges = JSON.parse(JSON.stringify(ranges))

  // Add first range to stack
  stack.push(ranges[0])

  for (let n = 1; n < ranges.length; ++n) {
    const range = ranges[n]
    const top = stack[stack.length - 1]

    if (top[1] < range[0]) {
      // No overlap, push range onto stack
      stack.push(range)
    } else if (top[1] < range[1]) {
      // Update previous range
      top[1] = range[1]
    }
  }

  return stack
}
