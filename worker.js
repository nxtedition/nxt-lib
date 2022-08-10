const EE = require('events')

module.exports.terminate = async function terminate(worker, { logger, timeout = 10e3 } = {}) {
  try {
    worker.postMessage({ type: 'nxt:worker:terminate' })
    await Promise.race([
      EE.once(worker, 'exit'),
      new Promise((resolve, reject) =>
        setTimeout(() => reject(new Error('worker close timeout')), timeout)
      ),
    ])
  } catch (err) {
    worker.terminate()
    logger?.error({ err })
  }
}
