module.exports = function (fnIterate, timeLimit, options = {}) {
  const startTime = performance.now()

  const { initial = 1, scaling = 10, safety = 1 } = options

  let remaining = timeLimit
  let nextN = (safety * initial) | 0
  let reps = 0

  for (;;) {
    fnIterate(nextN, remaining)

    const elapsed = performance.now() - startTime
    remaining = timeLimit - elapsed
    reps += nextN

    const timePerRep = elapsed / reps
    nextN = Math.floor(safety * Math.min(nextN * scaling, remaining / timePerRep))

    if (remaining <= 0 || nextN === 0) {
      return reps
    }
  }
}
