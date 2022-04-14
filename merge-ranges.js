module.exports = function mergeRanges(ranges) {
  if (!Array.isArray(ranges)) {
    return []
  }

  const stack = []

  ranges = ranges
    .filter((range) => range && range.length > 0 && range[1] > range[0])
    .sort((a, b) => a[0] - b[0])

  if (!ranges.length) {
    return []
  }

  ranges = JSON.parse(JSON.stringify(ranges))

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
