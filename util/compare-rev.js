const ordI = 'I'.charCodeAt(0)
const ordZero = '0'.charCodeAt(0)
const ordDash = '-'.charCodeAt(0)

const compareRevString = (a, b) => {
  // Handle INF-XXXXXXXX
  const isInfiniteA = a[0] === 'I'
  const isInfiniteB = b[0] === 'I'
  if (isInfiniteA) {
    if (!isInfiniteB) {
      return 1
    }
  } else if (isInfiniteB) {
    return -1
  }

  // Skip leading zeroes
  let indexA = 0
  let indexB = 0
  let lenA = a.length
  let lenB = b.length
  while (a[indexA] === '0') {
    ++indexA
    --lenA
  }
  while (b[indexB] === '0') {
    ++indexB
    --lenB
  }

  // Compare the revision number
  let result = 0
  const len = Math.min(lenA, lenB)
  while (indexA < len) {
    const ac = a[indexA++]
    const bc = b[indexB++]

    const isDashA = ac === '-'
    const isDashB = bc === '-'
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

  // Comapare the rest
  while (indexA < len) {
    const ac = a[indexA++]
    const bc = b[indexB++]
    if (ac === bc) {
      continue
    }
    return ac < bc ? -1 : 1
  }
  return lenA - lenB
}

const compareRevBuffer = (a, b) => {
  if (a === b) {
    return 0
  }

  // Handle INF-XXXXXXXX
  const isInfiniteA = a[0] === ordI
  const isInfiniteB = b[0] === ordI
  if (isInfiniteA) {
    if (!isInfiniteB) {
      return 1
    }
  } else if (isInfiniteB) {
    return -1
  }

  // Skip leading zeroes
  let indexA = 0
  let indexB = 0
  let lenA = a.length
  let lenB = b.length
  while (a[indexA] === ordZero) {
    ++indexA
    --lenA
  }
  while (b[indexB] === ordZero) {
    ++indexB
    --lenB
  }

  // Compare the revision number
  let result = 0
  const len = Math.min(lenA, lenB)
  while (indexA < len) {
    const ac = a[indexA++]
    const bc = b[indexB++]

    const isDashA = ac === ordDash
    const isDashB = bc === ordDash
    if (isDashA) {
      if (isDashB) {
        break
      }
      return -1
    } else if (isDashB) {
      return 1
    }

    result ||= ac - bc
  }
  if (result) {
    return result
  }

  // Comapare the rest
  while (indexA < len) {
    const ac = a[indexA++]
    const bc = b[indexB++]
    result = ac - bc
    if (result) {
      return result
    }
  }
  return lenA - lenB
}

const compareRev = (a, b) => {
  // Handle null and undefined
  /* eslint-disable eqeqeq */
  if (a == undefined) {
    return b == undefined ? 0 : -1
  } else if (b == undefined) {
    return 1
  }
  /* eslint-enable eqeqeq */

  const isStringA = typeof a === 'string'
  const isStringB = typeof b === 'string'

  return isStringA
    ? isStringB
      ? compareRevString(a, b)
      : compareRevString(a, b.toString())
    : isStringB
    ? compareRevString(a.toString(), b)
    : compareRevBuffer(a, b)
}

module.exports = compareRev
