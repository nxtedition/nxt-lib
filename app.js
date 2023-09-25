const { getDockerSecretsSync } = require('./docker-secrets')
const { getGlobalDispatcher } = require('undici')
const stream = require('node:stream')
const { Buffer } = require('node:buffer')
const net = require('net')
const fp = require('lodash/fp.js')
const assert = require('node:assert')

module.exports = function (appConfig, onTerminate) {
  let ds
  let nxt
  let toobusy
  let couch
  let server
  let compiler
  let config
  let logger
  let trace

  if (net.setDefaultAutoSelectFamily) {
    net.setDefaultAutoSelectFamily(false)
  }

  // Optimize some Node global defaults.

  Buffer.poolSize = 128 * 1024

  if (stream.setDefaultHighWaterMark) {
    stream.setDefaultHighWaterMark(false, 64 * 1024)
  }

  const isProduction = process.env.NODE_ENV === 'production'
  const ac = new AbortController()

  // Crash on unhandledRejection
  process.on('unhandledRejection', (err) => {
    throw err
  })

  process.on('warning', (err) => {
    logger?.warn({ err }, 'warning')
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
        isProduction,
        ...cleanAppConfig(appConfig),
        ...appConfig.config,
        ...(appConfig.secrets !== false ? getDockerSecretsSync() : {}), // TODO: deep merge?
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

  const destroyers = []

  const instanceId = process.env.NODE_APP_INSTANCE || process.env.pm_id || ''

  const serviceName = appConfig.name + (instanceId && instanceId !== '0' ? `-${instanceId}` : '')
  const serviceVersion = appConfig.version

  const userAgent = (globalThis.userAgent =
    appConfig.userAgent ||
    (serviceName ? `${serviceName}/${serviceVersion || '*'} Node/${process.version}` : null))

  const terminate = async (finalLogger) => {
    finalLogger ??= logger

    ac.abort()

    try {
      if (onTerminate) {
        try {
          await onTerminate(finalLogger)
        } catch (err) {
          finalLogger.error({ err }, 'terminate error')
        }
      }

      const dispatcher = getGlobalDispatcher()
      if (dispatcher?.close) {
        destroyers.push(async () => {
          const timeout = setTimeout(() => {
            dispatcher.destroy()
          }, 4e3)
          await dispatcher.close()
          clearTimeout(timeout)
        })
      }

      await Promise.all(destroyers.filter(Boolean).map((fn) => fn(finalLogger)))
    } catch (err) {
      finalLogger.error({ err }, 'shutdown error')
    }
  }

  {
    const loggerConfig = { ...appConfig.logger, ...config.logger }

    logger = createLogger(
      {
        ...loggerConfig,
        name: serviceName,
        base: loggerConfig?.base ? { ...loggerConfig.base } : {},
      },
      terminate,
    )
  }

  logger.debug({ data: JSON.stringify(config, null, 2) }, 'config')

  {
    const { isMainThread, parentPort } = require('node:worker_threads')
    if (!isMainThread && parentPort) {
      parentPort.on('message', ({ type }) => {
        if (type === 'nxt:worker:terminate') {
          terminate(null, true)
        }
      })
    }
  }

  if (appConfig.niceIncrement) {
    try {
      if (appConfig.niceIncrement !== 0 && process.platform === 'linux') {
        const nice = require('nice-napi')
        nice(appConfig.niceIncrement)
      }
    } catch {}
  }

  if (appConfig.perf && process.platform === 'linux') {
    const os = require('os')

    const containerId = appConfig.containerId ?? os.hostname()
    const hostname = process.env.NODE_ENV === 'production' ? containerId : serviceName

    const perfName = typeof appConfig.perf === 'string' ? appConfig.perf : hostname

    try {
      const linuxPerf = require('linux-perf')

      let started = false
      ds.rpc.provide(`${perfName}:perf.start`, () => {
        if (started) {
          return false
        }
        linuxPerf.start()
        started = true
        return true
      })
      ds.rpc.provide(`${perfName}:perf.stop`, () => {
        if (!started) {
          return false
        }
        linuxPerf.stop()
        started = false
        return true
      })
    } catch (err) {
      logger.error('could not initialize linux perf')
    }
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
    const couchConfig = fp.mergeAll(
      [
        { userAgent, url: isProduction ? null : 'ws://127.0.0.1:5984/nxt' },
        appConfig.couchdb,
        appConfig.couch,
        config.couchdb,
        config.couch,
      ].map((x) => {
        if (fp.isPlainObject(x)) {
          return x
        } else if (fp.isString(x)) {
          return { url: x }
        } else {
          return {}
        }
      }),
    )

    if (couchConfig.url) {
      const makeCouch = require('./couch')
      couch = makeCouch(couchConfig)
      destroyers.push(() => couch.close())
    } else {
      throw new Error('invalid couch config')
    }
  }

  if (appConfig.deepstream) {
    const deepstream = require('@nxtedition/deepstream.io-client-js')

    let dsConfig = fp.mergeAll(
      [
        { userAgent, url: isProduction ? null : 'ws://127.0.0.1:6020/deepstream' },
        appConfig.deepstream,
        config.deepstream,
      ].map((x) => {
        if (fp.isPlainObject(x)) {
          return x
        } else if (fp.isString(x)) {
          return { url: x }
        } else {
          return {}
        }
      }),
    )

    if (!dsConfig.credentials || !dsConfig.url) {
      throw new Error('invalid deepstream config')
    }

    const userName =
      dsConfig.credentials.username ||
      dsConfig.credentials.userName ||
      dsConfig.credentials.user ||
      serviceName

    dsConfig = {
      maxReconnectAttempts: Infinity,
      maxReconnectInterval: 10e3,
      ...dsConfig,
      credentials: {
        username: userName,
        ...dsConfig.credentials,
      },
    }

    const url = new URL(dsConfig.url)
    if (!url.pathname) {
      url.pathname = '/deepstream'
    }

    if (!url.port) {
      url.port = '6020'
    }

    let prevConnectionState
    ds = deepstream(url.toString(), dsConfig)
      .login(dsConfig.credentials, (success, authData) => {
        if (!success) {
          throw new Error('deepstream authentication failed.')
        }
      })
      .on('connectionStateChanged', (connectionState) => {
        const level =
          {
            CLOSED: 'info',
            AWAITING_CONNECTION: 'debug',
            CHALLENGING: 'debug',
            AWAITING_AUTHENTICATION: 'debug',
            AUTHENTICATING: 'debug',
            OPEN: 'info',
            ERROR: 'debug', // We get 'error' event anyway...
            RECONNECTING: 'warn',
          }[connectionState] || 'info'

        logger[level](
          { ds: { connectionState, username: userName, url: dsConfig.url } },
          'Deepstream Connection State Changed.',
        )

        prevConnectionState = connectionState
      })
      .on('error', (err) => {
        if (prevConnectionState !== 'OPEN' && /timeout/i.test(err)) {
          logger.warn({ err }, 'Deepstream Error.')
        } else {
          logger.error({ err }, 'Deepstream Error.')
        }
      })

    nxt = require('./deepstream')(ds)

    globalThis.ds = ds

    destroyers.push(() => ds.close())
  }

  if (appConfig.compiler) {
    const createTemplateCompiler = require('./util/template')
    compiler = createTemplateCompiler({ ds, ...appConfig.compiler })
  }

  const monitorProviders = {}

  let stats$
  if (appConfig.stats) {
    const v8 = require('v8')
    const rxjs = require('rxjs')
    const rx = require('rxjs/operators')
    const { eventLoopUtilization } = require('perf_hooks').performance

    if (typeof appConfig.stats.subscribe === 'function') {
      stats$ = appConfig.stats
    } else if (typeof appConfig.stats === 'function') {
      stats$ = rxjs.timer(0, 10e3).pipe(
        rx.exhaustMap(() => {
          const ret = appConfig.stats({ ds, couch, logger })
          return ret?.then || ret?.subscribe ? ret : rxjs.of(ret)
        }),
      )
    } else if (typeof appConfig.stats === 'object') {
      stats$ = rxjs.timer(0, 10e3).pipe(rx.map(() => appConfig.stats))
    } else {
      stats$ = rxjs.timer(0, 10e3).pipe(rx.map(() => ({})))
    }

    stats$ = stats$.pipe(
      rx.map((x) => ({
        ...x,
        timestamp: Date.now(),
      })),
      rx.auditTime(1e3),
      rx.filter(Boolean),
      rx.retryWhen((err$) =>
        err$.pipe(
          rx.tap((err) => logger.error({ err }, 'monitor.stats')),
          rx.delay(10e3),
        ),
      ),
      rx.startWith({}),
      rx.publishReplay(1),
      rx.refCount(),
    )

    monitorProviders.stats$ = stats$

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
          'STATS',
        )
        elu1 = elu2
      }
    })

    destroyers.push(() => {
      subscription.unsubscribe()
    })
  }

  let status$
  if (appConfig.status) {
    const rxjs = require('rxjs')
    const rx = require('rxjs/operators')
    const undici = require('undici')
    const fp = require('lodash/fp')
    const hashString = require('./hash')

    if (appConfig.status.subscribe) {
      status$ = appConfig.status
    } else if (typeof appConfig.status === 'function') {
      status$ = rxjs
        .defer(() => {
          const ret = appConfig.status({ ds, couch, logger })
          return ret?.then || ret?.subscribe ? ret : rxjs.of(ret)
        })
        .pipe(
          rx.catchError((err) => rxjs.of({ warnings: [err.message] })),
          rx.repeatWhen(() => rxjs.timer(10e3)),
        )
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
              return rxjs.of([
                {
                  id: 'app:user_monitor_status',
                  level: 50,
                  code: err.code,
                  msg: err.message,
                },
              ])
            }),
            rx.startWith([]),
            rx.distinctUntilChanged(fp.isEqual),
            rx.repeatWhen((complete$) => complete$.pipe(rx.delay(10e3))),
          ),
          toobusy
            ? rxjs.timer(0, 1e3).pipe(
                rx.map(() =>
                  toobusy.lag() > 1e3
                    ? [
                        {
                          id: 'app:toobusy_lag',
                          level: 40,
                          code: 'NXT_LAG',
                          msg: `lag: ${toobusy.lag()}`,
                        },
                      ]
                    : [],
                ),
                rx.startWith([]),
                rx.distinctUntilChanged(fp.isEqual),
              )
            : rxjs.of({}),
          couch
            ? rxjs.timer(0, 10e3).pipe(
                rx.exhaustMap(async () => {
                  try {
                    await couch.info()
                  } catch (err) {
                    return [
                      {
                        id: 'app:couch',
                        level: 40,
                        code: err.code,
                        msg: 'couch: ' + err.message,
                      },
                    ]
                  }
                }),
                rx.startWith([]),
                rx.distinctUntilChanged(fp.isEqual),
              )
            : rxjs.of({}),
          ds
            ? new rxjs.Observable((o) => {
                const client = new undici.Client(`http://${new URL(ds._url || ds.url).host}`, {
                  keepAliveTimeout: 30e3,
                })

                const subscription = rxjs
                  .timer(0, 10e3)
                  .pipe(
                    rx.exhaustMap(async () => {
                      const messages = []

                      if (ds.stats.record.records > 100e3) {
                        messages.push({
                          id: 'app:ds_record_records',
                          level: 40,
                          code: 'NXT_DEEPSTREAM_RECORDS_RECORDS',
                          msg: 'ds: ' + ds.stats.record.records + ' records',
                        })
                      }

                      if (ds.stats.record.pruning > 100e3) {
                        messages.push({
                          id: 'app:ds_record_pruning',
                          level: 40,
                          code: 'NXT_DEEPSTREAM_RECORDS_PRUNING',
                          msg: 'ds: ' + ds.stats.record.pruning + ' pruning',
                        })
                      }

                      if (ds.stats.record.pending > 10e3) {
                        messages.push({
                          id: 'app:ds_record_pending',
                          level: 40,
                          code: 'NXT_DEEPSTREAM_RECORDS_PENDING',
                          msg: 'ds: ' + ds.stats.record.pending + ' pending',
                        })
                      }

                      if (ds.stats.record.updating > 10e3) {
                        messages.push({
                          id: 'app:ds_record_updating',
                          level: 40,
                          code: 'NXT_DEEPSTREAM_RECORDS_UPDATING',
                          msg: 'ds: ' + ds.stats.record.updating + ' updating',
                        })
                      }

                      if (ds.stats.record.patching > 10e3) {
                        messages.push({
                          id: 'app:ds_record_patching',
                          level: 40,
                          code: 'NXT_DEEPSTREAM_RECORDS_PATCHING',
                          msg: 'ds: ' + ds.stats.record.patching + ' patching',
                        })
                      }

                      try {
                        const { body, statusCode } = await client.request({
                          method: 'GET',
                          path: '/healthcheck',
                        })
                        await body.dump()
                        assert(statusCode >= 200 && statusCode < 300)
                      } catch (err) {
                        messages.push({
                          id: 'app:ds_http_connection',
                          level: 40,
                          code: err.code,
                          msg: 'ds: ' + err.message,
                        })
                      }

                      return messages
                    }),
                  )
                  .subscribe(o)

                return () => {
                  client.destroy()
                  subscription.unsubscribe()
                }
              }).pipe(rx.startWith([]), rx.distinctUntilChanged(fp.isEqual))
            : rxjs.of({}),
          rxjs.timer(0, 10e3),
        ].filter(Boolean),
      )
      .pipe(
        rx.auditTime(1e3),
        rx.map(([status, lag, couch, ds]) => {
          const messages = [
            lag,
            couch,
            ds,
            [
              status?.messages,
              fp.map((x) => (fp.isString(x) ? { msg: x, level: 40 } : x), status?.warnings),
              status,
            ].find((x) => fp.isArray(x) && !fp.isEmpty(x)) ?? [],
          ]
            .flat()
            .filter((x) => fp.isPlainObject(x) && !fp.isEmpty(x))
            .map((message) =>
              message.msg || !message.message
                ? message
                : {
                    ...message,
                    message: undefined,
                    msg: message.message,
                  },
            )
            .map((message) =>
              message.id
                ? message
                : {
                    ...message,
                    id: hashString(
                      [message.msg, message].find(fp.isString) ?? JSON.stringify(message),
                    ),
                  },
            )

          return { ...status, messages, timestamp: Date.now() }
        }),
        rx.catchError((err) => {
          logger.error({ err }, 'monitor.status')
          return rxjs.of({
            messages: [{ id: 'app:monitor_status', level: 50, code: err.code, msg: err.message }],
          })
        }),
        rx.repeatWhen((complete$) => complete$.pipe(rx.delay(10e3))),
        rx.startWith({}),
        rx.distinctUntilChanged(fp.isEqual),
        rx.publishReplay(1),
        rx.refCount(),
      )

    const loggerSubscription = status$
      .pipe(rx.pluck('messages'), rx.startWith([]), rx.pairwise())
      .subscribe(([prev, next]) => {
        for (const { level, msg, ...message } of fp.differenceBy('id', next, prev)) {
          if (level >= 40) {
            logger.info(message, `status added: ${msg}`)
          }
        }
        for (const { level, msg, ...message } of fp.differenceBy('id', prev, next)) {
          if (level >= 40) {
            logger.info(message, `status removed: ${msg}`)
          }
        }
      })

    monitorProviders.status$ = status$

    destroyers.push(() => {
      loggerSubscription.unsubscribe()
    })
  }

  if (ds && Object.keys(monitorProviders).length && appConfig.monitor !== false) {
    const { isMainThread } = require('node:worker_threads')

    if (isMainThread) {
      const os = require('os')
      const rx = require('rxjs/operators')

      const containerId = appConfig.containerId ?? os.hostname()
      const hostname = process.env.NODE_ENV === 'production' ? containerId : serviceName

      const unprovide = ds.record.provide(`^([^:]+):monitor\\.([^?]+)[?]?`, (key) => {
        const [, id, prop] = key.match(/^([^:]+):monitor\.([^?]+)[?]?/)

        if (id === serviceName) {
          // TODO (fix): If id === serviceName check if there are multiple instances.
          return monitorProviders[prop + '$']?.pipe(rx.map((value) => ({ [hostname]: value })))
        }

        if (id === hostname) {
          return monitorProviders[prop + '$']
        }
      })

      destroyers.push(() => {
        if (unprovide) {
          unprovide()
        }
      })
    }
  }

  if (appConfig.trace) {
    const traceConfig = { ...appConfig.trace, ...config.trace }
    if (traceConfig.url) {
      const makeTrace = require('./trace')
      trace = makeTrace({ ...traceConfig, destroyers, logger, serviceName })
    }
  }

  if (appConfig.http) {
    // const undici = require('undici')
    const compose = require('koa-compose')
    const { createServer } = require('./http')
    const createError = require('http-errors')

    const httpConfig = { ...appConfig.http, ...config.http }

    const port = httpConfig.port
      ? httpConfig.port
      : typeof httpConfig === 'number'
      ? httpConfig
      : process.env.NODE_ENV === 'production'
      ? 8000
      : null

    if (port != null) {
      const middleware = compose(
        [
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
          (ctx, next) => {
            if (toobusy && toobusy()) {
              throw new createError.ServiceUnavailable('too busy')
            }
            return next()
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
          .filter(Boolean),
      )

      server = createServer(
        typeof appConfig.http === 'object' ? appConfig.http : {},
        { ds, couch, config: httpConfig, logger },
        middleware,
      )

      if (httpConfig.keepAlive != null) {
        server.keepAliveTimeout = httpConfig.keepAlive
      }

      if (httpConfig.timeout != null) {
        server.setTimeout(httpConfig.timeout)
      }

      if (httpConfig.headersTimeout == null) {
        server.headersTimeout = 2 * 60e3
      }

      if (httpConfig.headersTimeout == null) {
        server.requestTimeout = 0
      }

      server.listen(port)

      destroyers.push(() => new Promise((resolve) => server.close(resolve)))
    }
  }

  return {
    ds,
    nxt,
    logger,
    toobusy,
    couch,
    server,
    config,
    compiler,
    trace,
    tracer: trace,
    userAgent,
    serviceName,
    serviceVersion,
    signal: ac.signal,
  }
}
