
module.exports = function subtractRanges (_positiveRanges, negativeRanges) {
  const positiveRanges = _positiveRanges.slice(0)
  const difference = []

  let positiveRange
  while (positiveRanges.length) {
    positiveRange = positiveRanges.shift()

    for (const negativeRange of negativeRanges) {
      // complete cover
      if (
        negativeRange[0] <= positiveRange[0] &&
        positiveRange[1] <= negativeRange[1]
      ) {
        positiveRange = null
        break
      }

      // right cover
      if (
        negativeRange[0] < positiveRange[1] &&
        positiveRange[1] <= negativeRange[1]
      ) {
        positiveRange = [positiveRange[0], negativeRange[0]]
      }

      // left cover
      if (
        negativeRange[0] <= positiveRange[0] &&
        positiveRange[0] < negativeRange[1]
      ) {
        positiveRange = [negativeRange[1], positiveRange[1]]
      }

      // splitting
      if (
        negativeRange[0] < positiveRange[1] &&
        positiveRange[0] < negativeRange[1]
      ) {
        positiveRanges.unshift([negativeRange[1], positiveRange[1]])
        positiveRange = [positiveRange[0], negativeRange[0]]
      }
    }

    positiveRange && difference.push(positiveRange)
  }

  return difference
}
