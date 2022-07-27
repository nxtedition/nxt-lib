
module.exports = function (fnIterate, timeLimit, options = {}) {
	const startTime = Date.now()

	const {
		initial = 1,
		scaling = 10,
		safety = 1,
	} = options

	let remaining = timeLimit
	let nextN = (safety * initial) | 0
	let reps = 0

	for (;;) {
		fnIterate(nextN, remaining)

		const ellapsed = Date.now() - startTime
		remaining = timeLimit - ellapsed
		reps += nextN

		const timePerRep = ellapsed / reps
		nextN = Math.floor(safety * Math.min(nextN * scaling, remaining / timePerRep))

		if (remaining <= 0 || nextN === 0) {
			return reps
		}
	}
}
