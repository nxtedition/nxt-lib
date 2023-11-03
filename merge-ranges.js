const EMPTY_ARR = Object.freeze([])

module.exports = function mergeRanges(ranges) {
  if (!Array.isArray(ranges)) {
    return EMPTY_ARR
  }

  if (ranges.length === 1) {
    const range = ranges[0]
    return Array.isArray(range) && range.length === 2 && range[1] > range[0] ? ranges : EMPTY_ARR
  }

  {
    // Make sure ranges are valid and copied for mutation.
    const tmp = []
    for (let n = 0, len = ranges.length; n < len; n++) {
      const range = ranges[n]
      if (Array.isArray(range) && range.length === 2 && range[1] > range[0]) {
        tmp.push([range[0], range[1]])
      }
    }
    ranges = tmp
  }

  if (ranges.length <= 1) {
    return ranges
  }

  ranges.sort((a, b) => a[0] - b[0])

  const stack = []

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
