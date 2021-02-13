module.exports = function (appConfig, onTerminate) {
  let ds
  let nxt
  let toobusy
  let couch
  let server

  require('rxjs-compat')
  require('./rxjs')

  const { createLogger } = require('./logger')

  appConfig = { ...appConfig }

  const destroyers = [onTerminate]

  const serviceName = (
    appConfig.service?.name ||
    appConfig.name ||
    appConfig.logger?.name ||
    process.env.name
  )

  const logger = createLogger({
    ...appConfig.logger,
    name: appConfig.logger?.name || serviceName,
    base: appConfig.logger ? { ...appConfig.logger.base } : {}
  }, (finalLogger) => Promise
    .all(destroyers.filter(Boolean).map(fn => fn(finalLogger)))
    .catch(err => {
      if (err) {
        finalLogger.error({ err }, 'shutdown error')
      }
    })
  )

  if (appConfig.toobusy) {
    toobusy = require('toobusy-js')
    toobusy.onLag(currentLag => {
      if (currentLag > 1e3) {
        logger.error({ currentLag }, 'lag')
      } else {
        logger.warn({ currentLag }, 'lag')
      }
    })
  }

  if (appConfig.couchdb) {
    couch = require('./couch')({ config: appConfig })
  }

  if (appConfig.deepstream) {
    if (!appConfig.deepstream.credentials) {
      throw new Error('missing deepstream credentials')
    }

    const version = appConfig.version || process.env.NXT_VERSION

    const cacheName = serviceName + `${version ? `-${version}` : ''}`

    const userName = (
      appConfig.deepstream.credentials.username ||
      appConfig.deepstream.credentials.userName ||
      appConfig.deepstream.credentials.user ||
      serviceName
    )

    appConfig.deepstream = {
      url: 'ws://localhost:6020/deepstream',
      maxReconnectAttempts: Infinity,
      maxReconnectInterval: 10000,
      cacheSize: 2048,
      cache: cacheName ? `./.nxt${cacheName ? `-${cacheName}` : ''}` : undefined,
      ...appConfig.deepstream,
      credentials: {
        ...appConfig.deepstream.credentials,
        username: userName
      }
    }

    require('rxjs-compat')

    const deepstream = require('@nxtedition/deepstream.io-client-js')
    const cacheDb = appConfig.deepstream.cache ? require('leveldown')(appConfig.deepstream.cache) : null

    if (cacheDb) {
      logger.debug({ cache: appConfig.deepstream.cache }, 'Deepstream Caching')
    }

    ds = deepstream(appConfig.deepstream.url, {
      ...appConfig.deepstream,
      cacheDb
    })
      .login(appConfig.deepstream.credentials, (success, authData) => {
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

  if (appConfig.status) {
    const os = require('os')
    const { Observable } = require('rxjs')
    const fp = require('lodash/fp')

    let status$
    if (appConfig.status.subscribe) {
      status$ = appConfig.status
    } else if (typeof appConfig.status === 'function') {
      status$ = Observable
        .timer(0, 10e3)
        .exhaustMap(async () => {
          try {
            return await appConfig.status({ ds, couch, logger })
          } catch (err) {
            return { warnings: [err.message] }
          }
        })
    } else if (appConfig.status && typeof appConfig.status === 'object') {
      status$ = Observable
        .timer(0, 10e3)
        .exhaustMap(async () => appConfig.status)
    } else {
      status$ = Observable
        .timer(0, 10e3)
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
      .subscribe(([prev, next]) => {
        for (const message of fp.difference(next, prev)) {
          logger.warn({ message }, 'warning added')
        }
        for (const message of fp.difference(prev, next)) {
          logger.debug({ message }, 'warning removed')
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

  if (appConfig.stats) {
    const v8 = require('v8')
    const os = require('os')
    const { Observable } = require('rxjs')

    let stats$
    if (appConfig.stats.subscribe) {
      stats$ = appConfig.stats
    } else if (typeof appConfig.stats === 'function') {
      stats$ = Observable
        .timer(0, 10e3)
        .exhaustMap(async () => appConfig.stats({ ds, couch, logger }))
    } else if (appConfig.stats && typeof appConfig.stats === 'object') {
      stats$ = Observable
        .timer(0, 10e3)
        .exhaustMap(async () => appConfig.stats)
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

  if (appConfig.http) {
    const hasha = require('hasha')
    const http = require('http')

    const port = appConfig.http.port
      ? appConfig.http.port
      : typeof appConfig.http === 'number'
        ? appConfig.http
        : process.env.NODE_ENV === 'production'
          ? 8000
          : 8000 + parseInt(hasha(serviceName).slice(-3), 16)

    const request = appConfig.http.request
      ? appConfig.http.request
      : typeof appConfig.http === 'function'
        ? appConfig.http
        : null

    server = http
      .createServer(async (req, res) => {
        if (req.url.startsWith('/healthcheck')) {
          res.statusCode = 200
          res.end()
          return
        }

        if (request) {
          await request({ req, res, ds, couch, appConfig, logger })
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

  const config = nconf
    .argv()
    .env({
      separator: '__',
      parseValues: true
    })
    .defaults({
      name: process.env.name,
      version: process.env.NXT_VERSION,
      isProduction: process.env.NODE_ENV === 'production',
      ...appConfig,
      stats: null,
      status: null,
      couchdb: null,
      logger: null,
      toobusy: null,
      deepstream: null,
      http: null
    })
    .get()

  return { ds, nxt, logger, toobusy, destroyers, couch, server, config }
}
