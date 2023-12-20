import fs from 'node:fs'
import { isMainThread } from 'node:worker_threads'
import serializers from './serializers.js'
import pino from 'pino'
import xuid from 'xuid'

const isProduction = process.env.NODE_ENV === 'production'

export function createLogger(
  { level = isProduction ? 'debug' : 'trace', flushInterval = 1e3, stream = null, ...options } = {},
  onTerminate,
) {
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
        logger.warn('logger is flushing too slow')
        stream.flushSync()
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

  let called = false
  const finalHandler = async (err, evt) => {
    if (called) {
      return
    }
    called = true

    try {
      fs.writeFileSync(`/tmp/${new Date()}-${xuid()}`, JSON.stringify(err, undefined, 2), 'utf8')
    } catch {
      // Do nothing...
    }

    if (err) {
      if (!(err instanceof Error)) {
        err = new Error(err)
      }
      logger.fatal({ err }, evt || 'error caused exit')

      logger.flush()
    } else {
      logger.info(`${evt} caught`)

      let exitSignal
      try {
        exitSignal = onTerminate ? await onTerminate(logger) : null
      } catch (err) {
        exitSignal = err.exitSignal || 1
        logger.warn({ err })
      }

      logger.info({ exitSignal }, 'exit')

      logger.flush()
    }
  }

  process.on('exit', () => finalHandler(null, 'exit'))
  process.on('beforeExit', () => finalHandler(null, 'beforeExit'))
  process.on('SIGINT', () => finalHandler(null, 'SIGINT'))
  process.on('SIGQUIT', () => finalHandler(null, 'SIGQUIT'))
  process.on('SIGTERM', () => finalHandler(null, 'SIGTERM'))
  process.on('uncaughtException', (err, origin) => finalHandler(err, origin))

  return logger
}
