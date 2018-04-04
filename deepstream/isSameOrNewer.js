module.exports = function isSameOrNewer (a, b) {
  if (!b) {
    return true
  }
  if (b.startsWith('INF')) {
    return a.startsWith('INF')
  }
  if (!a) {
    return false
  }
  if (a.startsWith('INF')) {
    return true
  }

  const [ av, ar ] = splitRev(a)
  const [ bv, br ] = splitRev(b)

  return av > bv || (av === bv && ar >= br)
}

function splitRev (s) {
  const i = s.length - 15
  const ver = s.slice(0, i)
  return [ parseInt(ver, 10), s.slice(i + 1) ]
}
