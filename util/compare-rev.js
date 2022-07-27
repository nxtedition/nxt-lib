const STRING = { I: 'I', ZERO: '0', DASH: '-' }
const BUFFER = { I: 'I'.charCodeAt(0), ZERO: '0'.charCodeAt(0), DASH: '-'.charCodeAt(0) }

const compareRevImpl = (a, b, { I, ZERO, DASH }) => {
  // Handle INF-XXXXXXXX
  {
    const isInfA = a[0] === I
    const isInfB = b[0] === I
    if (isInfA !== isInfB) {
      return isInfB ? 1 : -1
    }
  }

  // Skip leading zeroes

  let indexA = 0
  let lenA = a.length
  while (a[indexA] === ZERO) {
    ++indexA
    --lenA
  }

  let indexB = 0
  let lenB = b.length
  while (b[indexB] === ZERO) {
    ++indexB
    --lenB
  }

  // Compare the revision number
  let result = 0
  const len = Math.min(lenA, lenB)
  while (indexA < len) {
    const ac = a[indexA++]
    const bc = b[indexB++]

    const isDashA = ac === DASH
    const isDashB = bc === DASH
    if (isDashA) {
      if (isDashB) {
        break
      }
      return -1
    } else if (isDashB) {
      return 1
    }

    result ||= ac === bc ? 0 : ac < bc ? -1 : 1
  }

  if (result) {
    return result
  }

  // Compare the rest
  while (indexA < len) {
    const ac = a[indexA++]
    const bc = b[indexB++]
    if (ac !== bc) {
      return ac < bc ? -1 : 1
    }
  }

  return lenA - lenB
}

module.exports = function (a, b) {
  if (!a || !a.length) {
    return !b || !b.length ? 0 : -1
  } else if (!b || !b.length) {
    return 1
  }

  return typeof a === 'string' || typeof b === 'string'
    ? compareRevImpl(a.toString('latin1'), b.toString('latin1'), STRING)
    : compareRevImpl(a, b, BUFFER)
}
