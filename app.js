module.exports = function (config, onTerminate) {
  let ds
  let nxt
  let toobusy

  const { createLogger } = require('./logger')

  config = { ...config }

  const logger = createLogger({
    ...config.logger,
    name: config.logger?.name || config.service?.name || config.name,
    base: config.logger ? { ...config.logger.base } : {}
  }, onTerminate)

  if (config.toobusy) {
    toobusy = require('toobusy-js')
    toobusy.onLag(currentLag => {
      if (currentLag > 5e3) {
        logger.error({ currentLag }, 'lag')
      } else {
        logger.warn({ currentLag }, 'lag')
      }
    })
  }

  if (config.deepstream) {
    const username = (
      config.deepstream.credentials.username ||
      config.service?.name ||
      config.name ||
      config.logger?.name
    )

    config.deepstream = {
      url: 'ws://localhost:6020/deepstream',
      maxReconnectAttempts: Infinity,
      maxReconnectInterval: 10000,
      cacheSize: 2048,
      ...config.deepstream,
      credentials: {
        ...config.deepstream.credentials,
        username
      }
    }

    require('rxjs-compat')

    const deepstream = require('@nxtedition/deepstream.io-client-js')
    const cacheDb = config.deepstream.cache ? require('leveldown')(config.deepstream.cache) : null

    if (cacheDb) {
      logger.debug({ cache: config.deepstream.cache }, 'Deepstream Caching')
    }

    ds = deepstream(config.deepstream.url, {
      ...config.deepstream,
      cacheDb
    })
      .login(config.deepstream.credentials, (success, authData) => {
        if (!success) {
          throw new Error('deepstream authentication failed.')
        }
      })
      .on('connectionStateChanged', connectionState => {
        const level = {
          CLOSED: 'error',
          AWAITING_CONNECTION: 'debug',
          CHALLENGING: 'debug',
          AWAITING_AUTHENTICATION: 'debug',
          AUTHENTICATING: 'debug',
          OPEN: 'info',
          ERROR: 'error',
          RECONNECTING: 'warn'
        }[connectionState] || 'info'
        logger[level]({ connectionState, username }, 'Deepstream Connection State Changed.')
      })
      .on('error', err => {
        logger.error({ err }, 'Deepstream Error.')
      })

    nxt = require('./deepstream')(ds)
  }

  if (config.status && config.status.subscribe && process.env.NODE_ENV === 'production' && ds) {
    const os = require('os')
    ds.nxt.record.provide(`${os.hostname()}:monitor.status`, () => config.status)
  }

  if (config.stats && process.env.NODE_ENV === 'production') {
    const v8 = require('v8')
    const os = require('os')

    // TOOD (fix): unref?

    let stats$
    if (config.stats.subscribe) {
      stats$ = config.stats
    } else if (typeof config.stats === 'function') {
      const { Observable } = require('rxjs')

      stats$ = Observable
        .interval(config.statsInterval || 10e3)
        .map(() => config.stats())
    } else {
      const { Observable } = require('rxjs')

      stats$ = Observable
        .interval(config.statsInterval || 10e3)
        .map(() => config.stats)
    }

    stats$ = stats$
      .auditTime(config.statsInterval || 10e3)
      .retryWhen(err$ => err$.do(err => logger.error({ err })).delay(10e3))

    if (process.env.NODE_ENV === 'production' && ds) {
      ds.nxt.record.provide(`${os.hostname()}:monitor.stats`, () => config.status)
    }

    stats$
      .auditTime(10e3)
      .retryWhen(err$ => err$.do(err => logger.error({ err })).delay(10e3))
      .subscribe((stats) => {
        logger.debug({
          ds: ds.stats,
          lag: toobusy && toobusy.lag(),
          memory: process.memoryUsage(),
          v8: {
            heap: v8.getHeapStatistics()
          },
          ...stats
        }, 'STATS')
      })
  }

  return { ds, nxt, logger, toobusy }
}
