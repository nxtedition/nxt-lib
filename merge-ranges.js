const EMPTY_ARR = Object.freeze([])

export default function mergeRanges(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) {
    return EMPTY_ARR
  }

  if (ranges.length === 1) {
    const range = ranges[0]
    return Array.isArray(range) && range.length === 2 && range[1] > range[0] ? ranges : EMPTY_ARR
  }

  ranges = ranges.filter(
    (range) => Array.isArray(range) && range.length === 2 && range[1] > range[0],
  )

  if (ranges.length <= 1) {
    return ranges
  }

  ranges.sort((a, b) => a[0] - b[0])

  const stack = []

  // Add first range to stack
  stack.push(ranges[0])

  for (let n = 1, len = ranges.length; n < len; ++n) {
    const range = ranges[n]
    const top = stack[stack.length - 1]

    if (range.length !== 2 || !Number.isFinite(range[0]) || !Number.isFinite(range[1])) {
      continue
    }

    if (top[1] < range[0]) {
      // No overlap, push range onto stack
      stack.push([range[0], range[1]])
    } else if (top[1] < range[1]) {
      // Update previous range
      top[1] = range[1]
    }
  }

  return stack
}
