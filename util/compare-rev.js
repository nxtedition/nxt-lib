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

  const av = a.charAt(0) === 'I' ? Infinity : parseInt(a)
  const bv = b.charAt(0) === 'I' ? Infinity : parseInt(b)

  if (av !== bv) {
    return av < bv ? -1 : 1
  }

  const ar = a.slice(a.indexOf('-') + 1)
  const br = b.slice(b.indexOf('-') + 1)

  return ar < br ? -1 : 1
}
