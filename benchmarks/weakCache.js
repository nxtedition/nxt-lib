const amrap = require('./util/amrap')

class WeakCache {
  constructor() {
    this._cache = new Map()
    this._registry = new FinalizationRegistry((key) => {
      const ref = this._cache.get(key)
      if (ref !== undefined && ref.deref() === undefined) {
        this._cache.delete(key)
      }
    })
  }

  set(key, value) {
    this._cache.set(key, { value, ref: new WeakRef(value) })
    this._registry.register(value, key)
  }

  get(key) {
    const entry = this._cache.get(key)
    if (entry === undefined) {
      return undefined
    }
    return (entry.value ??= entry.ref.deref())
  }
}

const map = new Map()
const weakMap = new WeakCache()

const NUM_CASES = 1e5
for (let i = 0; i < NUM_CASES; i++) {
  map.set(i, { id: i })
  weakMap.set(i, { id: i })
}
let caseIndex = 0

let tmp = 0

const funcs = {
  WeakMap: () => {
    tmp += weakMap.get(caseIndex).id
    if (++caseIndex === NUM_CASES) {
      caseIndex = 0
    }
  },
  Map: () => {
    tmp += map.get(caseIndex).id
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

console.log(tmp)
