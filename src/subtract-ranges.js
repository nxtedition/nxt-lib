const mergeRanges = require('merge-ranges')

module.exports = function subtractRanges (a, b) {
  a = mergeRanges(a)
  b = mergeRanges(b)

  const c = []

  while (a.length > 0) {
    const ar = a.shift()
    if (ar[0] < ar[1]) {
      const br = b.find(br => ar[0] < br[1] && br[0] < ar[1])
      if (!br) {
        c.push(ar)
      } else {
        a.unshift([ br[1], ar[1] ])
        a.unshift([ ar[0], br[0] ])
      }
    }
  }

  return c
}
