module.exports = function (config, onTerminate) {
  let ds
  let nxt
  let toobusy
  let couch
  let server

  const { createLogger } = require('./logger')

  config = { ...config }

  const destroyers = [onTerminate]

  const serviceName = (
    config.service?.name ||
    config.name ||
    config.logger?.name ||
    process.env.name
  )

  const logger = createLogger({
    ...config.logger,
    name: config.logger?.name || serviceName,
    base: config.logger ? { ...config.logger.base } : {}
  }, (finalLogger) => Promise
    .all(destroyers.filter(Boolean).map(fn => fn(finalLogger)))
    .catch(err => {
      if (err) {
        finalLogger.error({ err }, 'shutdown error')
      }
    })
  )

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

  if (config.couchdb) {
    couch = require('./couch')({ config })
  }

  if (typeof config.http === 'function' || config.http === true) {
    const hasha = require('hasha')
    const http = require('http')

    const port = parseInt(hasha(serviceName).slice(-13), 16)

    server = http
      .createServer(typeof config.http === 'function'
        ? config.http
        : (req, res) => {
            if (!req.url.startsWith('/healthcheck')) {
              res.statusCode = 404
            } else {
              res.statusCode = 200
            }
            res.end()
          }
      )
      .listen(process.env.NODE_ENV === 'production' ? 8000 : port, () => {
        logger.debug({ port }, `http listening on port ${port}`)
      })

    destroyers.push(() => new Promise(resolve => server.close(resolve)))
  }

  if (config.deepstream) {
    if (!config.deepstream.credentials) {
      throw new Error('missing deepstream credentials')
    }

    const version = config.version || process.env.NXT_VERSION

    const cacheName = serviceName + `${version ? `-${version}` : ''}`

    const userName = (
      config.deepstream.credentials.username ||
      config.deepstream.credentials.userName ||
      config.deepstream.credentials.user ||
      serviceName
    )

    config.deepstream = {
      url: 'ws://localhost:6020/deepstream',
      maxReconnectAttempts: Infinity,
      maxReconnectInterval: 10000,
      cacheSize: 2048,
      cache: cacheName ? `./.nxt${cacheName ? `-${cacheName}` : ''}` : undefined,
      ...config.deepstream,
      credentials: {
        ...config.deepstream.credentials,
        username: userName
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
        logger[level]({ connectionState, username: userName }, 'Deepstream Connection State Changed.')
      })
      .on('error', err => {
        logger.error({ err }, 'Deepstream Error.')
      })

    nxt = require('./deepstream')(ds)
  }

  if (config.status && config.status.subscribe && process.env.NODE_ENV === 'production' && ds) {
    const os = require('os')

    let status$
    if (config.status.subscribe) {
      status$ = config.status
    } else if (typeof config.status === 'function') {
      const { Observable } = require('rxjs')

      status$ = Observable
        .interval(10e3)
        .map(() => config.status())
    } else if (config.status && typeof config.status === 'object') {
      const { Observable } = require('rxjs')

      status$ = Observable
        .interval(10e3)
        .map(() => config.status)
    } else {
      throw new Error('invalid status')
    }

    status$ = status$.retryWhen(err$ => err$.do(err => logger.error({ err })).delay(10e3))

    if (process.env.NODE_ENV === 'production' && ds) {
      ds.nxt.record.provide(`^${os.hostname()}:monitor.status$`, () => status$)
    }
  }

  if (config.stats && process.env.NODE_ENV === 'production') {
    const v8 = require('v8')
    const os = require('os')

    let stats$
    if (config.stats.subscribe) {
      stats$ = config.stats
    } else if (typeof config.stats === 'function') {
      const { Observable } = require('rxjs')

      stats$ = Observable
        .interval(10e3)
        .map(() => config.stats())
    } else if (config.stats && typeof config.stats === 'object') {
      const { Observable } = require('rxjs')

      stats$ = Observable
        .interval(10e3)
        .map(() => config.stats)
    } else {
      throw new Error('invalid stats')
    }

    stats$ = stats$.retryWhen(err$ => err$.do(err => logger.error({ err })).delay(10e3))

    if (process.env.NODE_ENV === 'production' && ds) {
      ds.nxt.record.provide(`${os.hostname()}:monitor.stats`, () => config.status)
    }

    const subscription = stats$
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

    destroyers.push(() => {
      subscription.unsubscribe()
    })
  }

  return { ds, nxt, logger, toobusy, destroyers, couch, server }
}
