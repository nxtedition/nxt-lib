module.exports = function (appConfig, onTerminate) {
  let ds
  let nxt
  let toobusy
  let couch
  let server
  let compiler
  let config
  let logger

  // Crash on unhandledRejection
  process.on('unhandledRejection', (err) => {
    throw err
  })

  const { createLogger } = require('./logger')

  const cleanAppConfig = ({
    status,
    stats,
    http,
    logger,
    deepstream,
    couchdb,
    couch,
    esc,
    toobusy,
    config,
    compiler,
    ...values
  }) => values

  if (appConfig.config) {
    const nconf = require('nconf')

    config = nconf
      .argv()
      .env({
        separator: '__',
        parseValues: true,
      })
      .defaults({
        isProduction: process.env.NODE_ENV === 'production',
        ...cleanAppConfig(appConfig),
        ...appConfig.config,
      })
      .get()

    for (const key of Object.keys(config)) {
      if (/^(nvm|npm|pm2)_/i.test(key)) {
        delete config[key]
      }
    }
  } else {
    config = {
      isProduction: process.env.NODE_ENV === 'production',
      ...cleanAppConfig(appConfig),
      ...appConfig,
    }
  }

  const destroyers = [onTerminate]

  const instanceId = process.env.NODE_APP_INSTANCE || process.env.pm_id || ''

  const serviceName = appConfig.name + (instanceId && instanceId !== '0' ? `-${instanceId}` : '')

  {
    const loggerConfig = { ...appConfig.logger, ...config.logger }

    logger = createLogger(
      {
        ...loggerConfig,
        name: serviceName,
        base: loggerConfig?.base ? { ...loggerConfig.base } : {},
      },
      (finalLogger) =>
        Promise.all(destroyers.filter(Boolean).map((fn) => fn(finalLogger))).catch((err) => {
          if (err) {
            finalLogger.error({ err }, 'shutdown error')
          }
        })
    )
  }

  if (appConfig.toobusy) {
    toobusy = require('toobusy-js')
    toobusy.onLag((currentLag) => {
      if (currentLag > 1e3) {
        logger.error({ currentLag }, 'lag')
      } else {
        logger.warn({ currentLag }, 'lag')
      }
    })
  }

  if (appConfig.couchdb || appConfig.couch) {
    const couchConfig = {
      ...(appConfig.couchdb || appConfig.couch),
      ...(config.couchdb ?? config.couch),
    }
    couch = require('./couch')(couchConfig)
  }

  if (appConfig.deepstream) {
    const deepstream = require('@nxtedition/deepstream.io-client-js')
    const EE = require('events')
    const LRUCache = require('lru-cache')

    let dsConfig = { ...appConfig.deepstream, ...config.deepstream }

    if (!dsConfig.credentials) {
      throw new Error('missing deepstream credentials')
    }

    const userName =
      dsConfig.credentials.username ||
      dsConfig.credentials.userName ||
      dsConfig.credentials.user ||
      serviceName

    class Cache extends EE {
      constructor({ max = 32 * 1024 }) {
        super()
        this._lru = new LRUCache({ max })
      }

      get(key, callback) {
        callback(null, this._lru.get(key))
      }

      set(key, value) {
        this._lru.set(key, value)
      }
    }

    let dsCache

    if (typeof dsConfig.cache === 'function') {
      dsCache = dsConfig.cache()
    } else if (dsConfig.cache === undefined || typeof dsConfig.cache === 'object') {
      dsCache = new Cache(dsConfig.cache || {})
    }

    dsConfig = {
      url: 'ws://127.0.0.1:6020/deepstream',
      maxReconnectAttempts: Infinity,
      maxReconnectInterval: 10e3,
      cache: dsCache,
      ...dsConfig,
      credentials: {
        username: userName,
        ...dsConfig.credentials,
      },
    }

    ds = deepstream(dsConfig.url, dsConfig)
      .login(dsConfig.credentials, (success, authData) => {
        if (!success) {
          throw new Error('deepstream authentication failed.')
        }
      })
      .on('connectionStateChanged', (connectionState) => {
        const level =
          {
            CLOSED: 'error',
            AWAITING_CONNECTION: 'debug',
            CHALLENGING: 'debug',
            AWAITING_AUTHENTICATION: 'debug',
            AUTHENTICATING: 'debug',
            OPEN: 'info',
            ERROR: 'error',
            RECONNECTING: 'warn',
          }[connectionState] || 'info'
        logger[level](
          { connectionState, username: userName, url: dsConfig.url },
          'Deepstream Connection State Changed.'
        )
      })
      .on('error', (err) => {
        logger.error({ err }, 'Deepstream Error.')
      })

    nxt = require('./deepstream')(ds)

    globalThis.ds = ds
  }

  if (appConfig.compiler) {
    const createTemplateCompiler = require('./util/template')
    compiler = createTemplateCompiler({ ds })
  }

  const monitorProviders = {}

  if (appConfig.status) {
    const rxjs = require('rxjs')
    const rx = require('rxjs/operators')
    const undici = require('undici')
    const fp = require('lodash/fp')
    const xxhash = require('xxhash-wasm')

    let hasher
    xxhash().then((x) => {
      hasher = x
    })

    let status$
    if (appConfig.status.subscribe) {
      status$ = appConfig.status
    } else if (typeof appConfig.status === 'function') {
      status$ = rxjs
        .defer(() => {
          const ret = appConfig.status({ ds, couch, logger })
          return ret?.then || ret?.subscribe ? ret : rxjs.of(ret)
        })
        .catch((err) => rxjs.of({ warnings: [err.message] }))
        .repeatWhen(() => rxjs.timer(10e3))
    } else if (appConfig.status && typeof appConfig.status === 'object') {
      status$ = rxjs.timer(0, 10e3).pipe(rx.exhaustMap(() => appConfig.status))
    } else {
      status$ = rxjs.of({})
    }

    status$ = rxjs
      .combineLatest(
        [
          status$.pipe(
            rx.filter(Boolean),
            rx.catchError((err) => {
              logger.error({ err }, 'monitor.status')
              return rxjs.of({
                id: 'app:user_monitor_status',
                level: 50,
                code: err.code,
                msg: err.message,
              })
            }),
            rx.distinctUntilChanged(fp.isEqual),
            rx.repeatWhen((complete$) => complete$.pipe(rx.delay(10e3))),
            rx.startWith(null)
          ),
          toobusy &&
            rxjs.timer(0, 1e3).pipe(
              rx.map(() =>
                toobusy.lag() > 1e3
                  ? {
                      id: 'app:toobusy_lag',
                      level: 40,
                      code: 'NXT_LAG',
                      msg: `lag: ${toobusy.lag()}`,
                    }
                  : null
              ),
              rx.distinctUntilChanged(fp.isEqual),
              rx.startWith(null)
            ),
          couch &&
            rxjs.timer(0, 10e3).pipe(
              rx.exhaustMap(async () => {
                try {
                  await couch.info()
                } catch (err) {
                  return {
                    id: 'app:couch',
                    level: 40,
                    code: err.code,
                    msg: 'couch: ' + err.message,
                  }
                }
              }),
              rx.distinctUntilChanged(fp.isEqual),
              rx.startWith(null)
            ),
          ds &&
            new rxjs.Observable((o) => {
              const client = new undici.Client(`http://${new URL(ds._url || ds.url).host}`, {
                keepAliveTimeout: 30e3,
              })

              const subscription = rxjs
                .timer(0, 10e3)
                .pipe(
                  rx.exhaustMap(async () => {
                    try {
                      const { body } = await client.request({ method: 'GET', path: '/healthcheck' })
                      await body.dump()
                    } catch {
                      try {
                        const { body } = await client.request({
                          method: 'GET',
                          path: '/healthcheck',
                        })
                        await body.dump()
                      } catch (err) {
                        return {
                          id: 'app:ds_http_connection',
                          level: 40,
                          code: err.code,
                          msg: 'ds: ' + err.message,
                        }
                      }
                    }
                  }),
                  rx.distinctUntilChanged(fp.isEqual)
                )
                .subscribe(o)

              return () => {
                client.destroy()
                subscription.unsubscribe()
              }
            }).pipe(rx.startWith(null)),
          ds &&
            new rxjs.Observable((o) => {
              const _next = (state) => {
                o.next({
                  id: 'app:ds_connection',
                  level: state !== 'OPEN' ? 50 : 30,
                  code: `NXT_DEEPSTREAM_${state}`,
                  msg: `deepstream connection state is ${state}`,
                })
              }
              ds.on('connectionStateChanged', _next)
              return () => {
                ds.off('connectionStateChanged', _next)
              }
            }).pipe(rx.startWith(null)),
        ].filter(Boolean)
      )
      .pipe(
        rx.auditTime(1e3),
        rx.map(([status, lag, couch, ds, dsConnected]) => {
          const messages = [
            lag,
            couch,
            ds,
            dsConnected,
            [status?.messages, status] // Compat
              .find(Array.isArray)
              ?.flat()
              .filter(fp.isPlainObject),
            [status?.warnings, status] // Compat
              .find(Array.isArray)
              ?.flat()
              .filter(fp.isString)
              .map((warning) => ({ level: 40, msg: warning })),
          ]
            .flat()
            .filter(fp.isPlainObject)
            .map((message) =>
              message.msg || !message.message
                ? message
                : {
                    ...message,
                    message: undefined,
                    msg: message,
                  }
            )
            .map((message) =>
              message.id
                ? message
                : {
                    ...message,
                    id: hasher.h32ToString(message.msg ?? message ?? ''),
                  }
            )

          return { ...status, messages }
        }),
        rx.catchError((err) => {
          logger.error({ err }, 'monitor.status')
          return rxjs.of({ id: 'app:monitor_status', level: 50, code: err.code, msg: err.message })
        }),
        rx.repeatWhen((complete$) => complete$.pipe(rx.delay(10e3))),
        rx.startWith({}),
        rx.publishReplay(1),
        rx.refCount()
      )

    const loggerSubscription = status$
      .pipe(rx.pluck('messages'), rx.startWith([]), rx.pairwise())
      .subscribe(([prev, next]) => {
        for (const { level, msg, ...message } of fp.differenceBy('id', next, prev)) {
          logger.info(message, `status added: ${msg}`)
        }
        for (const { level, msg, ...message } of fp.differenceBy('id', prev, next)) {
          logger.info(message, `status removed: ${msg}`)
        }
      })

    monitorProviders.status$ = status$

    destroyers.push(() => {
      loggerSubscription.unsubscribe()
    })
  }

  if (appConfig.stats) {
    const v8 = require('v8')
    const os = require('os')
    const rxjs = require('rxjs')
    const rx = require('rxjs/operators')
    const { eventLoopUtilization } = require('perf_hooks').performance

    let stats$
    if (appConfig.stats.subscribe) {
      stats$ = appConfig.stats
    } else if (typeof appConfig.stats === 'function') {
      stats$ = rxjs.timer(0, 10e3).pipe(
        rx.exhaustMap(() => {
          const ret = appConfig.stats({ ds, couch, logger })
          return ret?.then || ret?.subscribe ? ret : rxjs.of(ret)
        })
      )
    } else if (appConfig.stats && typeof appConfig.stats === 'object') {
      stats$ = rxjs.timer(0, 10e3).pipe(rx.exhaustMap(() => appConfig.stats))
    } else {
      stats$ = rxjs.of({})
    }

    stats$ = stats$.pipe(
      rx.auditTime(1e3),
      rx.filter(Boolean),
      rx.retryWhen((err$) =>
        err$.pipe(
          rx.tap((err) => logger.error({ err }, 'monitor.stats')),
          rx.delay(10e3)
        )
      ),
      rx.startWith({}),
      rx.publishReplay(1),
      rx.refCount()
    )

    const containerId = appConfig.containerId ?? os.hostname()
    const hostname = process.env.NODE_ENV === 'production' ? containerId : serviceName

    monitorProviders.stats$ = stats$

    logger.debug({ hostname }, 'monitor.stats')

    let elu1 = eventLoopUtilization?.()
    const subscription = stats$.pipe(rx.auditTime(10e3)).subscribe((stats) => {
      if (process.env.NODE_ENV === 'production') {
        const elu2 = eventLoopUtilization?.()
        logger.debug(
          {
            ds: ds?.stats,
            couch: couch?.stats,
            lag: toobusy?.lag(),
            memory: process.memoryUsage(),
            utilization: eventLoopUtilization?.(elu2, elu1),
            heap: v8.getHeapStatistics(),
            ...stats,
          },
          'STATS'
        )
        elu1 = elu2
      }
    })

    destroyers.push(() => {
      subscription.unsubscribe()
    })
  }

  if (ds && Object.keys(monitorProviders).length) {
    const os = require('os')

    const containerId = appConfig.containerId ?? os.hostname()
    const hostname = process.env.NODE_ENV === 'production' ? containerId : serviceName

    logger.debug({ hostname }, 'monitor')

    const unprovide = ds.record.provide(`^([^:]+):monitor\\.([^?]+)[?]?`, (key) => {
      const [, id, prop] = key.match(/^([^:]+):monitor\.([^?]+)[?]?/)
      return id === hostname && monitorProviders[prop + '$']
    })

    destroyers.push(() => {
      if (unprovide) {
        unprovide()
      }
    })
  }

  if (appConfig.http) {
    const http = require('http')
    // const undici = require('undici')
    const compose = require('koa-compose')
    const { request } = require('./http')

    const httpConfig = { ...appConfig.http, ...config.http }

    const port = httpConfig.port
      ? httpConfig.port
      : typeof httpConfig === 'number'
      ? httpConfig
      : process.env.NODE_ENV === 'production'
      ? 8000
      : null

    if (port != null) {
      const requestHandler = compose(
        [
          request,
          async ({ req, res }, next) => {
            if (req.url.startsWith('/healthcheck')) {
              // if (ds._url || ds.url) {
              //   try {
              //     const { host } = new URL(ds._url || ds.url)
              //     await undici.request(`http://${host}/healthcheck`)
              //   } catch (err) {
              //     logger.warn({ err }, 'deepstream healthcheck failed')
              //     if (err.code === 'ENOTFOUND' || err.code === 'EHOSTUNREACH') {
              //       throw err
              //     }
              //   }
              // }

              // if (couch) {
              //   try {
              //     await couch.info()
              //   } catch (err) {
              //     logger.warn({ err }, 'couch healthcheck failed')
              //     if (err.code === 'ENOTFOUND' || err.code === 'EHOSTUNREACH') {
              //       throw err
              //     }
              //   }
              // }

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
          },
        ]
          .flat()
          .filter(Boolean)
      )

      server = http.createServer(
        typeof appConfig.http === 'object' ? appConfig.http : {},
        async (req, res) => {
          requestHandler({ req, res, ds, couch, config: httpConfig, logger })
        }
      )

      if (httpConfig.keepAlive != null) {
        server.keepAliveTimeout = httpConfig.keepAlive
      }

      if (httpConfig.timeout != null) {
        server.setTimeout(httpConfig.timeout)
      }

      server.listen(port, () => {
        logger.debug({ port }, `http listening on port ${port}`)
      })

      destroyers.push(() => new Promise((resolve) => server.close(resolve)))
    }
  }

  return { ds, nxt, logger, toobusy, destroyers, couch, server, config, compiler }
}
