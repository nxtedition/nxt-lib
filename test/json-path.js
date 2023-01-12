const { test } = require('tap')
const jsonPath = require('../json-path')
const fp = require('lodash/fp')

test('merge', (t) => {
  function check(val1, val2) {
    t.same(
      jsonPath.merge(val1, null, val2),
      fp.merge(val1 ?? {}, val2),
      `${JSON.stringify(val1, undefined, 2)} ${JSON.stringify(val2, undefined, 2)}`
    )
  }

  check(null, { asd: 1 })
  check({ asd: 1 }, null)

  // TODO (fix): Array merging on root is unclear
  // check(null, [1])
  // check([2], null)
  // check({ asd: 1 }, [1, 2, undefined, 3])
  // check([1, 2, undefined, 3], { asd: 1 })

  t.end()
})

// // Fuzz
// const { randomObject } = require('random-object')
// for (let n = 0; n < 100000; n++) {
//   const val1 = randomObject()
//   const val2 = randomObject()
//   const res1 = jsonPath.merge(val1, null, val2)
//   const res2 = fp.merge(val1, val2)
//   if (!fp.isEqual(res1, res2)) {
//     console.error(JSON.stringify(res1, undefined, 2), JSON.stringify(res2, undefined, 2))
//     break
//   }
// }
