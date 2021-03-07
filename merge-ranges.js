module.exports = function mergeRanges(ranges) {
  if (!Array.isArray(ranges) || !ranges.length) {
    return []
  }

  const stack = []

  ranges = [...ranges].sort((a, b) => {
    return a[0] - b[0]
  })

  // Add first range to stack
  stack.push(ranges[0])

  for (let n = 1; n < ranges.length; ++n) {
    const range = ranges[n]

    if (range[1] <= range[0]) {
      continue
    }

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
