module.exports = function (appConfig, onTerminate) {
  let ds
  let nxt
  let toobusy
  let couch
  let server
  let compiler
  let config
  let logger

  const { createLogger } = require('./logger')

  const cleanAppConfig = ({
    status,
    stats,
    http,
    logger,
    deepstream,
    couchdb,
    couch,
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
    const loggerConfig = { ...appConfig, ...config.logger }

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
    const leveldown = require('leveldown')
    const levelup = require('levelup')
    const encodingdown = require('encoding-down')
    const EE = require('events')

    let dsConfig = { ...appConfig.deepstream, ...config.deepstream }

    if (!dsConfig.credentials) {
      throw new Error('missing deepstream credentials')
    }

    const userName =
      dsConfig.credentials.username ||
      dsConfig.credentials.userName ||
      dsConfig.credentials.user ||
      serviceName

    function defaultFilter(name, version, data) {
      return (!name || name.charAt(0) !== '{') && (!version || version.charAt(0) !== '0')
    }

    const dsCache = new (class Cache extends EE {
      constructor({ cacheLocation, cacheDb, cacheFilter = defaultFilter }) {
        super()

        if (!cacheDb) {
          this.location = cacheLocation ?? `./.nxt-${serviceName}`
          this._db = levelup(
            encodingdown(leveldown(this.location), {
              valueEncoding: 'json',
            }),
            (err) => {
              if (err) {
                logger.debug({ err, path: this.location }, 'Deepstream Cache Failed.')
                throw err
              }
            }
          )
        } else {
          this._db = cacheDb
          this.location = this._db.location ?? cacheLocation
        }

        logger.debug({ path: this.location }, 'Deepstream Cache Created.')

        this._cache = new Map()
        this._db
          .on('open', (err) => {
            logger.debug({ err, path: this.location }, 'Deepstream Cache Open.')
          })
          .on('closed', (err) => {
            logger.debug({ err, path: this.location }, 'Deepstream Cache Closed.')
            this._db = null
          })
          .on('error', (err) => {
            logger.error({ err, path: this.location }, 'Deepstream Cache Error.')
            // TODO: What happens with pending get requests?
            this._db = null
          })
        this._filter = cacheFilter
        this._batch = []
        this._registry = new FinalizationRegistry((key) => {
          const ref = this._cache.get(key)
          if (ref !== undefined && ref.deref() === undefined) {
            this._cache.delete(key)
          }
        })
        this._interval = setInterval(() => {
          this._flush()
        }, 1e3).unref()

        destroyers.push(
          () =>
            new Promise((resolve, reject) => {
              if (this._db && this._db.close) {
                this._db.close((err) => (err ? reject(err) : resolve()))
              }
              clearInterval(this._interval)
            })
        )
      }

      get(name, callback) {
        // TODO (perf): Check filter.

        const key = name

        const ref = this._cache.get(key)
        if (ref !== undefined) {
          const deref = ref.deref()
          if (deref !== undefined) {
            process.nextTick(callback, null, deref)
            return
          }
        }

        if (this._db) {
          this._db.get(key, callback)
        } else {
          process.nextTick(callback, null, null)
        }
      }

      set(name, version, data) {
        if (this._filter && !this._filter(name, version, data)) {
          return
        }

        const key = name
        const value = [version, data]

        this._cache.set(key, new WeakRef(value))
        this._registry.register(value, key)
        this._batch.push({ type: 'put', key, value })
        if (this._batch.length > 1024) {
          this._flush()
        }
      }

      _flush() {
        if (this._db) {
          this._db.batch(this._batch, (err) => {
            if (err) {
              logger.error({ err, path: this.location }, 'Deepstream Cache Error.')
            }
          })
        }
        this._batch = []
      }
    })(dsConfig)

    dsConfig = {
      url: 'ws://localhost:6020/deepstream',
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
  }

  if (appConfig.compiler) {
    const createTemplateCompiler = require('./util/template')
    compiler = createTemplateCompiler({ ds })
  }

  if (appConfig.status) {
    const os = require('os')
    const rxjs = require('rxjs')
    const rx = require('rxjs/operators')
    const undici = require('undici')
    const fp = require('lodash/fp')
    const objectHash = require('object-hash')

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
            rx.startWith(null),
            rx.distinctUntilChanged(fp.isEqual),
            rx.catchError((err) => {
              logger.error({ err }, 'monitor.status')
              return rxjs.of({ level: 50, code: err.code, msg: err.message })
            }),
            rx.repeatWhen((complete$) => complete$.pipe(rx.delay(10e3)))
          ),
          toobusy &&
            rxjs.timer(0, 1e3).pipe(
              rx.map(() =>
                toobusy.lag() > 1e3
                  ? { level: 40, code: 'NXT_LAG', msg: `lag: ${toobusy.lag()}` }
                  : null
              ),
              rx.distinctUntilChanged(fp.isEqual)
            ),
          couch &&
            rxjs.timer(0, 10e3).pipe(
              rx.exhaustMap(async () => {
                try {
                  await couch.info()
                } catch (err) {
                  return { level: 40, code: err.code, msg: 'couch: ' + err.message }
                }
              }),
              rx.distinctUntilChanged(fp.isEqual)
            ),
          ds &&
            rxjs.timer(0, 10e3).pipe(
              rx.exhaustMap(async () => {
                try {
                  if (ds._url || ds.url) {
                    const { host } = new URL(ds._url || ds.url)
                    await undici.request(`http://${host}/healthcheck`)
                  }
                } catch (err) {
                  return { level: 40, code: err.code, msg: 'ds: ' + err.message }
                }
              }),
              rx.distinctUntilChanged(fp.isEqual)
            ),
          ds &&
            new rxjs.Observable((o) => {
              const _next = (state) => {
                o.next({
                  level: state !== 'OPEN' ? 50 : 30,
                  code: `NXT_DEEPSTREAM_${state}`,
                  msg: `ds: ${state}`,
                })
              }
              ds.on('connectionStateChanged', _next)
              return () => {
                ds.off('connectionStateChanged', _next)
              }
            }),
        ].filter(Boolean)
      )
      .pipe(
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
            .map((message) => ({
              ...message,
              id: message.id || objectHash(message),
            }))

          const warnings = messages.filter((x) => x.level >= 40 && x.msg).map((x) => x.msg)

          return {
            ...status,
            messages,
            warnings: warnings.length === 0 ? null : warnings, // Compat
          }
        }),
        rx.catchError((err) => {
          logger.error({ err }, 'monitor.status')
          return rxjs.of({ level: 50, code: err.code, msg: err.message })
        }),
        rx.repeatWhen((complete$) => complete$.pipe(rx.delay(10e3))),
        rx.startWith({}),
        rx.publishReplay(1),
        rx.refCount()
      )

    const loggerSubscription = status$
      .pipe(rx.pluck('messages'), rx.startWith([]), rx.pairwise())
      .subscribe(([prev, next]) => {
        for (const { msg, ...message } of fp.differenceBy('id', next, prev)) {
          logger.info({ status: msg, message }, 'status added')
        }
        for (const { msg, ...message } of fp.differenceBy('id', prev, next)) {
          logger.info({ status: msg, message }, 'status removed')
        }
      })

    const containerId = appConfig.containerId ?? os.hostname()
    const hostname = process.env.NODE_ENV === 'production' ? containerId : serviceName

    logger.debug({ hostname }, 'monitor.status')

    const unprovide = nxt?.record.provide(
      'monitor.status',
      (id) => (id === hostname ? status$ : null),
      { id: true }
    )

    destroyers.push(() => {
      if (unprovide) {
        unprovide()
      }
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

    const unprovide = nxt?.record.provide(
      'monitor.stats',
      (id) => (id === hostname ? stats$ : null),
      { id: true }
    )

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
      if (unprovide) {
        unprovide()
      }
      subscription.unsubscribe()
    })
  }

  if (appConfig.http) {
    const http = require('http')
    const undici = require('undici')
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
              if (ds._url || ds.url) {
                try {
                  const { host } = new URL(ds._url || ds.url)
                  await undici.request(`http://${host}/healthcheck`)
                } catch (err) {
                  logger.warn({ err }, 'deepstream healthcheck failed')
                  if (err.code === 'ENOTFOUND') {
                    throw err
                  }
                }
              }

              if (couch) {
                try {
                  await couch.info()
                } catch (err) {
                  logger.warn({ err }, 'couch healthcheck failed')
                  if (err.code === 'ENOTFOUND') {
                    throw err
                  }
                }
              }

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
