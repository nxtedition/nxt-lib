module.exports = function compareRev (a, b) {
  if (!a) {
    return b ? -1 : 0
  }

  if (!b) {
    return a ? 1 : 0
  }

  if (a === b) {
    return 0
  }

  const [av, ar] = splitRev(a)
  const [bv, br] = splitRev(b)

  return av !== bv ? (av < bv ? -1 : 1) : (ar < br ? -1 : 1)
}

function splitRev (s) {
  const i = s.indexOf('-')
  const ver = s.slice(0, i)

  return [ver === 'INF' ? Infinity : parseInt(ver, 10), s.slice(i + 1)]
}
