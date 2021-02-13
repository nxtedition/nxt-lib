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
      if (currentLag > 1e3) {
        logger.error({ currentLag }, 'lag')
      } else {
        logger.warn({ currentLag }, 'lag')
      }
    })
  }

  if (config.couchdb) {
    couch = require('./couch')({ config })
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

  if (config.status) {
    const os = require('os')
    const { Observable } = require('rxjs')
    const fp = require('lodash/fp')

    let status$
    if (config.status.subscribe) {
      status$ = config.status
    } else if (typeof config.status === 'function' || config.status === true) {
      status$ = Observable
        .interval(10e3)
        .exhaustMap(async () => {
          try {
            return await config.status({ ds, couch, logger })
          } catch (err) {
            return { warnings: [err.message] }
          }
        })
    } else if (config.status && typeof config.status === 'object') {
      status$ = Observable
        .interval(10e3)
        .exhaustMap(async () => config.status)
    } else {
      status$ = Observable
        .interval(10e3)
        .mapTo({})
    }

    status$ = Observable
      .combineLatest([
        status$
          .filter(Boolean)
          .startWith(null),
        new Observable(o => {
          toobusy.onLag(currentLag => {
            if (currentLag > 1e3) {
              o.next(`lag: ${currentLag}`)
            }
          })
          o.next(null)
        }),
        Observable
          .timer(0, 10e3)
          .exhaustMap(async () => {
            try {
              couch?.info()
            } catch (err) {
              return 'couch: ' + err.message
            }
          })
      ])
      .map(([status, lag, couch]) => ({
        ...status,
        warnings: [...(status?.warnings || []), lag, couch].filter(Boolean)
      }))
      .retryWhen(err$ => err$.do(err => logger.error({ err })).delay(10e3))
      .publishReplay(1)
      .refCount()

    const subscription = status$
      .pluck('warnings')
      .startWith([])
      .pairwise()
      .scan((prev, next) => {
      }, [])
      .subscribe(([prev, next]) => {
        for (const add of fp.difference(next, prev)) {
          logger.warn({ message: add }, 'warning added')
        }
        for (const rm of fp.difference(prev, next)) {
          logger.debug({ message: rm }, 'warning removed')
        }
      })

    const hostname = process.env.NODE_ENV === 'production' ? os.hostname() : serviceName

    logger.debug({ hostname }, 'monitor.status')

    const unprovide = nxt?.record.provide(`^${hostname}:monitor.status$`, () => status$)

    destroyers.push(() => {
      if (unprovide) {
        unprovide()
      }
      subscription.unsubscribe()
    })
  }

  if (config.stats) {
    const v8 = require('v8')
    const os = require('os')
    const { Observable } = require('rxjs')

    let stats$
    if (config.stats.subscribe) {
      stats$ = config.stats
    } else if (typeof config.stats === 'function') {
      stats$ = Observable
        .timer(0, 10e3)
        .exhaustMap(async () => config.stats({ ds, couch, logger }))
    } else if (config.stats && typeof config.stats === 'object') {
      stats$ = Observable
        .timer(0, 10e3)
        .exhaustMap(async () => config.stats)
    } else {
      stats$ = Observable
        .timer(0, 10e3)
        .mapTo({})
    }

    stats$ = stats$
      .filter(Boolean)
      .retryWhen(err$ => err$.do(err => logger.error({ err })).delay(10e3))
      .publishReplay(1)
      .refCount()

    const hostname = process.env.NODE_ENV === 'production' ? os.hostname() : serviceName

    const unprovide = nxt?.record.provide(`${hostname}:monitor.stats`, () => stats$)

    logger.debug({ hostname }, 'monitor.stats')

    const subscription = stats$
      .auditTime(10e3)
      .retryWhen(err$ => err$.do(err => logger.error({ err })).delay(10e3))
      .subscribe((stats) => {
        if (process.env.NODE_ENV === 'production') {
          logger.debug({
            ds: ds.stats,
            lag: toobusy && toobusy.lag(),
            memory: process.memoryUsage(),
            v8: {
              heap: v8.getHeapStatistics()
            },
            ...stats
          }, 'STATS')
        }
      })

    destroyers.push(() => {
      if (unprovide) {
        unprovide()
      }
      subscription.unsubscribe()
    })
  }

  if (config.http) {
    const hasha = require('hasha')
    const http = require('http')

    const port = config.http.port
      ? config.http.port
      : typeof config.http === 'number'
        ? config.http
        : process.env.NODE_ENV === 'production'
          ? 8000
          : 8000 + parseInt(hasha(serviceName).slice(-3), 16)

    const request = config.http.request
      ? config.http.request
      : typeof config.http === 'function'
        ? config.http
        : null

    server = http
      .createServer(async (req, res) => {
        if (req.url.startsWith('/healthcheck')) {
          res.statusCode = 200
          res.end()
          return
        }

        if (request) {
          await request({ req, res, ds, couch, config, logger })
        }

        if (!res.writableEnded) {
          res.statusCode = 404
          res.end()
        }
      })
      .listen(port, () => {
        logger.debug({ port }, `http listening on port ${port}`)
      })

    destroyers.push(() => new Promise(resolve => server.close(resolve)))
  }

  const nconf = require('nconf')

  config = nconf
    .argv()
    .env({
      separator: '__',
      parseValues: true
    })
    .defaults({
      name: process.env.name,
      version: process.env.NXT_VERSION,
      isProduction: process.env.NODE_ENV === 'production',
      ...config,
      stats: null,
      status: null,
      logger: null,
      toobusy: null,
      http: null
    })
    .get()

  return { ds, nxt, logger, toobusy, destroyers, couch, server, config }
}
