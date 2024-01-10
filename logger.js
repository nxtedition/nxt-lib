import assert from 'node:assert'
import { isMainThread } from 'node:worker_threads'
import serializers from './serializers.js'
import pino from 'pino'

const isProduction = process.env.NODE_ENV === 'production'

export function createLogger(
  { level = isProduction ? 'debug' : 'trace', flushInterval = 1e3, stream = null, ...options } = {},
  onTerminate,
) {
  assert(!onTerminate)

  if (!stream) {
    if (
      process.stdout.write !== process.stdout.constructor.prototype.write ||
      process.stdout.fd == null
    ) {
      stream = process.stdout
    }
  }

  if (stream) {
    // Do nothing...
  } else if (!isProduction) {
    stream = pino.destination({ fd: process.stdout.fd ?? 1, sync: true })
  } else if (!isMainThread) {
    stream = pino.destination({ fd: 1, sync: false, minLength: 0 })
  } else {
    stream = pino.destination({ sync: false, minLength: 8 * 1024, maxWrite: 32 * 1024 })

    let flushing = 0
    setInterval(() => {
      if (flushing > 60) {
        try {
          logger.warn('logger is flushing too slow')
          stream.flushSync()
        } catch (err) {
          console.error(err)
        }
      } else {
        flushing++
        stream.flush(() => {
          flushing--
        })
      }
    }, flushInterval).unref()
  }

  const logger = pino(
    {
      level,
      ...options,
      serializers: {
        ...serializers,
        ...options.serializers,
      },
    },
    stream,
  )

  return logger
}
