const ordI = 'I'.charCodeAt(0)
const ordZero = '0'.charCodeAt(0)
const ordDash = '-'.charCodeAt(0)

const compareRevStringString = (a, b) => {
  // Handle INF-XXXXXXXX
  {
    const isInfA = a[0] === 'I'
    const isInfB = b[0] === 'I'
    if (isInfA !== isInfB) {
      return isInfB ? -1 : 1
    }
  }

  let indexA = 0
  const endA = a.length
  let lenA = endA

  let indexB = 0
  const endB = b.length
  let lenB = endB

  // Skip leading zeroes
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
  while (indexA < endA && indexB < endB) {
    const ac = a[indexA++]
    const bc = b[indexB++]

    if (ac === '-') {
      if (bc === '-') {
        break
      }
      return -1
    } else if (bc === '-') {
      return 1
    }

    result ||= ac === bc ? 0 : ac < bc ? -1 : 1
  }

  if (result) {
    return result
  }

  // Compare the rest
  while (indexA < endA && indexB < endB) {
    const ac = a[indexA++]
    const bc = b[indexB++]
    if (ac !== bc) {
      return ac < bc ? -1 : 1
    }
  }

  return lenA - lenB
}

const compareRevBufferBuffer = (a, b) => {
  if (a === b) {
    return 0
  }

  // Handle INF-XXXXXXXX
  {
    const isInfA = a[0] === ordI
    const isInfB = b[0] === ordI
    if (isInfA !== isInfB) {
      return isInfB ? -1 : 1
    }
  }

  let indexA = 0
  const endA = a.length
  let lenA = endA

  let indexB = 0
  const endB = b.length
  let lenB = endB

  // Skip leading zeroes
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
  while (indexA < endA && indexB < endB) {
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

  // Compare the rest
  while (indexA < endA && indexB < endB) {
    const ac = a[indexA++]
    const bc = b[indexB++]
    result = ac - bc
    if (result) {
      return result
    }
  }

  return lenA - lenB
}

const compareRevBufferString = (a, b) => {
  // Handle INF-XXXXXXXX
  {
    const isInfA = a[0] === ordI
    const isInfB = b[0] === 'I'
    if (isInfA !== isInfB) {
      return isInfB ? -1 : 1
    }
  }

  let indexA = 0
  const endA = a.length
  let lenA = endA

  let indexB = 0
  const endB = b.length
  let lenB = endB

  // Skip leading zeroes
  while (a[indexA] === ordZero) {
    ++indexA
    --lenA
  }
  while (b[indexB] === '0') {
    ++indexB
    --lenB
  }

  // Compare the revision number
  let result = 0
  while (indexA < endA && indexB < endB) {
    const ac = String.fromCharCode(a[indexA++])
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

  // Compare the rest
  while (indexA < endA && indexB < endB) {
    const ac = String.fromCharCode(a[indexA++])
    const bc = b[indexB++]
    if (ac !== bc) {
      return ac < bc ? -1 : 1
    }
  }

  return lenA - lenB
}

module.exports = function (a, b) {
  // Handle null and undefined
  if (!a || !a.length) {
    return !b || !b.length ? 0 : -1
  } else if (!b || !b.length) {
    return 1
  }

  const isStringA = typeof a === 'string'
  const isStringB = typeof b === 'string'

  return isStringA
    ? isStringB
      ? compareRevStringString(a, b)
      : -compareRevBufferString(b, a)
    : isStringB
    ? compareRevBufferString(a, b)
    : compareRevBufferBuffer(a, b)
}
