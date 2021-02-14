module.exports = function (appConfig, onTerminate) {
  let ds
  let nxt
  let toobusy
  let couch
  let server
  let compiler
  let config

  require('rxjs-compat')
  require('./rxjs')

  const { createLogger } = require('./logger')

  if (appConfig.config) {
    const nconf = require('nconf')

    appConfig = config = nconf
      .argv()
      .env({
        separator: '__',
        parseValues: true
      })
      .defaults({
        name: process.env.name,
        version: process.env.NXT_VERSION,
        isProduction: process.env.NODE_ENV === 'production',
        ...appConfig
      })
      .get()
  }

  const destroyers = [onTerminate]

  const instanceId = process.env.NODE_APP_INSTANCE || process.env.pm_id || ''

  const serviceName = (
    appConfig.service?.name ||
    appConfig.name ||
    appConfig.logger?.name ||
    process.env.name
  ) + (instanceId ? `-${instanceId}` : '')

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

  if (appConfig.couchdb || appConfig.couch) {
    couch = require('./couch')({ config: appConfig })
  }

  if (appConfig.deepstream) {
    const deepstream = require('@nxtedition/deepstream.io-client-js')
    const leveldown = require('leveldown')

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

    const dsConfig = {
      url: 'ws://localhost:6020/deepstream',
      maxReconnectAttempts: Infinity,
      maxReconnectInterval: 10e3,
      cacheSize: 4096,
      cacheDb: leveldown(`./.nxt${cacheName ? `-${cacheName}` : ''}`),
      ...appConfig.deepstream,
      credentials: {
        username: userName,
        ...appConfig.deepstream.credentials
      }
    }

    if (dsConfig.cacheDb) {
      logger.debug({ cache: dsConfig.cacheDb.location }, 'Deepstream Caching')
    }

    ds = deepstream(dsConfig.url, dsConfig)
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

  if (appConfig.compiler) {
    const createTemplateCompiler = require('./util/template')
    compiler = createTemplateCompiler({ ds })
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
        .defer(() => {
          const ret = appConfig.status({ ds, couch, logger })
          return ret?.then || ret?.subscribe ? ret : Observable.of(ret)
        })
        .catch(err => Observable.of({ warnings: [err.message] }))
        .repeatWhen(() => Observable.timer(10e3))
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
          toobusy?.onLag(currentLag => {
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
      .map(([status, lag, couch]) => {
        const warnings = [
          status?.warnings,
          status
        ].find(Array.isArray)

        return {
          ...status,
          warnings: [warnings, lag, couch].flat().filter(Boolean)
        }
      })
      .retryWhen(err$ => err$.do(err => logger.error({ err }, 'monitor.status')).delay(10e3))
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
        .exhaustMap(() => {
          const ret = appConfig.stats({ ds, couch, logger })
          return ret?.then || ret?.subscribe ? ret : Observable.of(ret)
        })
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
      .retryWhen(err$ => err$.do(err => logger.error({ err }, 'monitor.stats')).delay(10e3))
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
    const compose = require('koa-compose')
    const { request } = require('./http')

    const port = appConfig.http.port
      ? appConfig.http.port
      : typeof appConfig.http === 'number'
        ? appConfig.http
        : process.env.NODE_ENV === 'production'
          ? 8000
          : 8000 + parseInt(hasha(serviceName).slice(-3), 16)

    const requestHandler = compose([
      request,
      ({ req, res }, next) => {
        if (req.url.startsWith('/healthcheck')) {
          res.statusCode = 200
          res.end()
        } else {
          return next()
        }
      },
      appConfig.http.request
        ? appConfig.http.request
        : typeof appConfig.http === 'function'
          ? appConfig.http
          : null,
      ({ res }) => {
        res.statusCode = 404
        res.end()
      }
    ].flat().filter(Boolean))

    server = http
      .createServer((req, res) => {
        if (req.url.startsWith('/healthcheck')) {
          res.statusCode = 200
          res.end()
          return
        }

        requestHandler({ req, res, ds, couch, config, logger })
      })
      .listen(port, () => {
        logger.debug({ port }, `http listening on port ${port}`)
      })

    destroyers.push(() => new Promise(resolve => server.close(resolve)))
  }

  return { ds, nxt, logger, toobusy, destroyers, couch, server, config, compiler }
}
