import { once } from 'node:events'

export async function terminate(worker, { logger = null, timeout = 10e3 } = {}) {
  try {
    worker.postMessage({ type: 'nxt:worker:terminate' })
    await Promise.race([
      once(worker, 'exit'),
      new Promise((resolve, reject) =>
        setTimeout(() => reject(new Error('worker close timeout')), timeout),
      ),
    ])
  } catch (err) {
    worker.terminate()
    logger?.error({ err })
  }
}
