module.exports = function (appConfig, onTerminate) {
  let ds
  let nxt
  let toobusy
  let couch
  let server
  let compiler
  let config
  let logger

  require('rxjs-compat')
  require('./rxjs')

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
        parseValues: true
      })
      .defaults({
        isProduction: process.env.NODE_ENV === 'production',
        ...cleanAppConfig(appConfig),
        ...appConfig.config
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
      ...appConfig
    }
  }

  const destroyers = [onTerminate]

  const instanceId = process.env.NODE_APP_INSTANCE || process.env.pm_id || ''

  const serviceName = appConfig.name + (instanceId && instanceId !== '0' ? `-${instanceId}` : '')

  {
    const loggerConfig = { ...appConfig, ...config.logger }

    logger = createLogger({
      ...loggerConfig,
      name: serviceName,
      base: loggerConfig?.base ? { ...loggerConfig.base } : {}
    }, (finalLogger) => Promise
      .all(destroyers.filter(Boolean).map(fn => fn(finalLogger)))
      .catch(err => {
        if (err) {
          finalLogger.error({ err }, 'shutdown error')
        }
      })
    )
  }

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
    const couchConfig = { ...(appConfig.couchdb || appConfig.couch), ...(config.couchdb ?? config.couch) }
    couch = require('./couch')(couchConfig)
  }

  if (appConfig.deepstream) {
    const deepstream = require('@nxtedition/deepstream.io-client-js')
    const leveldown = require('leveldown')
    const levelup = require('levelup')
    const encodingDown = require('encoding-down')
    const EE = require('events')

    let dsConfig = { ...appConfig.deepstream, ...config.deepstream }

    if (!dsConfig.credentials) {
      throw new Error('missing deepstream credentials')
    }

    const userName = (
      dsConfig.credentials.username ||
      dsConfig.credentials.userName ||
      dsConfig.credentials.user ||
      serviceName
    )

    function defaultFilter (name, version, data) {
      return (
        (!name || name.charAt(0) !== '{') &&
        (!version || version.charAt(0) !== '0')
      )
    }

    const dsCache = new class Cache extends EE {
      constructor ({ cacheName, cacheFilter = defaultFilter }) {
        super()
        this.location = `./.nxt-${cacheName || serviceName}`
        this._cache = new Map()

        this._db = levelup(encodingDown(leveldown(this.location), { valueEncoding: 'json' }), (err) => {
          if (err) {
            throw err
          }
        })
          .on('open', (err) => {
            logger.debug({ err, path: this.location }, 'Deepstream Cache Open.')
          })
          .on('closed', (err) => {
            logger.debug({ err, path: this.location }, 'Deepstream Cache Closed.')
          })
          .on('error', (err) => {
            logger.error({ err, path: this.location }, 'Deepstream Cache Error.')
          })
        this._filter = cacheFilter
        this._batch = []
        this._registry = new FinalizationRegistry(key => {
          const ref = this._cache.get(key)
          if (ref !== undefined && ref.deref() === undefined) {
            this._cache.delete(key)
          }
        })
        this._interval = setInterval(() => {
          this._flush()
        }, 1e3).unref()
      }

      get (name, callback) {
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

        this._db.get(key, callback)
      }

      set (name, version, data) {
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

      _flush () {
        this._db.batch(this._batch, err => {
          if (err) {
            logger.error({ err, path: this.location }, 'Deepstream Cache Error.')
          }
        })
        this._batch = []
      }
    }(dsConfig)

    dsConfig = {
      url: 'ws://localhost:6020/deepstream',
      maxReconnectAttempts: Infinity,
      maxReconnectInterval: 10e3,
      cache: dsCache,
      ...dsConfig,
      credentials: {
        username: userName,
        ...dsConfig.credentials
      }
    }

    if (dsConfig.cacheDb) {
      throw new Error('deepstream.cacheDb not supported')
    }

    ds = deepstream(dsConfig.url, dsConfig)
      .login(dsConfig.credentials, (success, authData) => {
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
    const undici = require('undici')
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
      status$ = Observable.of({})
    }

    status$ = Observable
      .combineLatest([
        status$
          .filter(Boolean)
          .startWith(null)
          .distinctUntilChanged(fp.isEqual),
        toobusy && Observable
          .timer(0, 1e3)
          .map(() => toobusy.lag() > 1e3 ? { level: 40, code: 'NXT_LAG', msg: `lag: ${toobusy.lag()}` } : null)
          .distinctUntilChanged(fp.isEqual),
        couch && Observable
          .timer(0, 10e3)
          .exhaustMap(async () => {
            try {
              await couch.info()
            } catch (err) {
              return { level: 40, code: err.code, msg: 'couch: ' + err.message }
            }
          })
          .distinctUntilChanged(fp.isEqual),
        ds && Observable
          .timer(0, 10e3)
          .exhaustMap(async () => {
            try {
              if (ds._url || ds.url) {
                const { host } = new URL(ds._url || ds.url)
                await undici.request(`http://${host}/healthcheck`)
              }
            } catch (err) {
              return { level: 40, code: err.code, msg: 'ds: ' + err.message }
            }
          })
          .distinctUntilChanged(fp.isEqual)
      ].filter(Boolean))
      .map(([status, lag, couch, ds]) => {
        const messages = [
          lag,
          couch,
          ds,
          [status?.messages, status] // Compat
            .find(Array.isArray)
            ?.flat()
            .filter(fp.isPlainObject),
          [status?.warnings, status] // Compat
            .find(Array.isArray)
            ?.flat()
            .filter(fp.isString)
            .map(warning => ({ level: 40, msg: warning }))
        ].flat().filter(fp.isPlainObject)

        const warnings = messages
          .filter(x => x.level >= 40 && x.msg)
          .map(x => x.msg)

        return {
          ...status,
          messages,
          warnings: warnings.length === 0 ? null : warnings // Compat
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

    const unprovide = nxt?.record.provide(`${hostname}:monitor.status`, () => status$)

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
      stats$ = Observable.of({})
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
      .subscribe((stats) => {
        if (process.env.NODE_ENV === 'production') {
          logger.debug({
            ds: ds?.stats,
            couch: couch?.stats,
            lag: toobusy?.lag(),
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
      const requestHandler = compose([
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
        }
      ].flat().filter(Boolean))

      server = http
        .createServer(typeof appConfig.http === 'object' ? appConfig.http : {}, async (req, res) => {
          requestHandler({ req, res, ds, couch, config: httpConfig, logger })
        })

      if (httpConfig.keepAlive != null) {
        server.keepAliveTimeout = httpConfig.keepAlive
      }

      if (httpConfig.timeout != null) {
        server.setTimeout(httpConfig.timeout)
      }

      server.listen(port, () => {
        logger.debug({ port }, `http listening on port ${port}`)
      })

      destroyers.push(() => new Promise(resolve => server.close(resolve)))
    }
  }

  return { ds, nxt, logger, toobusy, destroyers, couch, server, config, compiler }
}
