import os from 'node:os'
import net from 'node:net'
import stream from 'node:stream'
import { Buffer } from 'node:buffer'
import { getDockerSecretsSync } from './docker-secrets.js'
import fp from 'lodash/fp.js'
import { isMainThread, parentPort } from 'node:worker_threads'
import toobusy from 'toobusy-js'
import deepstream from '@nxtedition/deepstream.io-client-js'
import { createLogger } from './logger.js'
import nconf from 'nconf'
import { makeCouch } from './couch.js'
import { makeTemplateCompiler } from './util/template/index.js'
import { makeDeepstream } from './deepstream.js'
import v8 from 'v8'
import * as rxjs from 'rxjs'
import rx from 'rxjs/operators'
import { performance } from 'perf_hooks'
import hashString from './hash.js'
import { makeTrace } from './trace.js'
import compose from 'koa-compose'
import { createServer } from './http.js'

export function makeApp(appConfig, onTerminate) {
  let ds
  let nxt
  let couch
  let server
  let compiler
  let config
  let logger
  let trace

  const destroyers = []

  if (net.setDefaultAutoSelectFamily) {
    net.setDefaultAutoSelectFamily(false)
  }

  // Optimize some Node global defaults.

  Buffer.poolSize = 128 * 1024

  if (stream.setDefaultHighWaterMark) {
    stream.setDefaultHighWaterMark(false, 128 * 1024)
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

  const appDestroyers = []

  const serviceName = appConfig.name
  const serviceModule = appConfig.module ?? 'main'
  const serviceVersion = appConfig.version
  const serviceInstanceId =
    // process.env.name is the pm2 name of the process
    appConfig.instanceId ?? appConfig.containerId ?? process.env.name ?? os.hostname()

  const userAgent = (globalThis.userAgent =
    appConfig.userAgent ??
    (serviceName &&
      `${serviceName}/${
        serviceVersion || '*'
      } (module:${serviceModule}; instance:${serviceInstanceId}) Node/${process.version}`) ??
    null)

  {
    const loggerConfig = { ...appConfig.logger, ...config.logger }

    process.on('uncaughtExceptionMonitor', (err) => {
      logger.fatal({ err }, 'uncaught exception')
    })

    logger = createLogger({
      ...loggerConfig,
      name: serviceName,
      base: loggerConfig?.base ? { module: serviceModule, ...loggerConfig.base } : {},
    })

    appDestroyers.push(
      () =>
        new Promise((resolve, reject) => {
          try {
            logger.flush((err) => (err ? reject(err) : resolve(null)))
          } catch (err) {
            console.error(err)
          }
        }),
    )
  }

  let terminated = false
  const terminate = async (reason) => {
    if (terminated) {
      return
    }

    terminated = true

    logger.info({ reason }, 'terminate')

    ac.abort()

    if (onTerminate) {
      try {
        await onTerminate(logger)
      } catch (err) {
        logger.error({ err }, 'terminate error')
      }
    }

    for (const { reason: err } of await Promise.allSettled(
      destroyers.filter(Boolean).map((fn) => fn(logger)),
    )) {
      if (err) {
        logger.error({ err }, 'shutdown error')
      }
    }

    for (const { reason: err } of await Promise.allSettled(
      appDestroyers.filter(Boolean).map((fn) => fn(logger)),
    )) {
      if (err) {
        logger.error({ err }, 'shutdown error')
      }
    }

    setTimeout(() => {
      logger.error('aborting')
      if (isMainThread) {
        process.exit(1)
      } else {
        // TODO (fix): What to do here?
      }
    }, 10e3).unref()
  }

  process
    .on('beforeExit', () => terminate('beforeExit'))
    .on('SIGINT', () => terminate('SIGINT'))
    .on('SIGTERM', () => terminate('SIGTERM'))
    .on('uncaughtExceptionMonitor', () => terminate('uncaughtExceptionMonitor'))

  logger.debug({ data: JSON.stringify(config, null, 2) }, 'config')

  if (!isMainThread && parentPort) {
    parentPort.on('message', ({ type }) => {
      if (type === 'nxt:worker:terminate') {
        terminate('nxt:worker:terminate')
      }
    })
  }

  if (appConfig.toobusy) {
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
      couch = makeCouch(couchConfig)
      appDestroyers.push(() => couch.close())
    } else {
      throw new Error('invalid couch config')
    }
  }

  if (appConfig.deepstream) {
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

    nxt = makeDeepstream(ds)

    globalThis.ds = ds

    appDestroyers.push(() => ds.close())
  }

  if (appConfig.compiler) {
    compiler = makeTemplateCompiler({ ds, ...appConfig.compiler })
  }

  const monitorProviders = {}

  let stats$
  if (appConfig.stats) {
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

    let elu1 = performance.eventLoopUtilization?.()
    const subscription = stats$.pipe(rx.auditTime(10e3)).subscribe((stats) => {
      if (process.env.NODE_ENV === 'production') {
        const elu2 = performance.eventLoopUtilization?.()
        logger.debug(
          {
            ds: ds?.stats,
            couch: couch?.stats,
            lag: toobusy?.lag(),
            memory: process.memoryUsage(),
            utilization: performance.eventLoopUtilization?.(elu2, elu1),
            heap: v8.getHeapStatistics(),
            ...stats,
          },
          'STATS',
        )
        elu1 = elu2
      }
    })

    appDestroyers.push(() => {
      subscription.unsubscribe()
    })
  }

  let status$
  if (appConfig.status) {
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
                    try {
                      await couch.up()
                    } catch {
                      await couch.info()
                    }
                    return [
                      {
                        id: 'app:couch',
                        level: 30,
                        msg: 'couch: connected',
                      },
                    ]
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
            ? rxjs.fromEvent(ds, 'connectionStateChanged').pipe(
                rxjs.map((connectionState) =>
                  connectionState === 'OPEN'
                    ? [
                        {
                          id: 'app:ds_connection_state',
                          level: 30,
                          msg: 'ds: connected',
                          data: { connectionState },
                        },
                      ]
                    : [
                        {
                          id: 'app:ds_connection_state',
                          level: 40,
                          msg: 'ds: connecting',
                          data: { connectionState },
                        },
                      ],
                ),
              )
            : rxjs.of([]),
          ds
            ? rxjs.timer(0, 10e3).pipe(
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

                  return messages
                }),
              )
            : rxjs.of([]),
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

    appDestroyers.push(() => {
      loggerSubscription.unsubscribe()
    })
  }

  if (ds && Object.keys(monitorProviders).length && appConfig.monitor !== false) {
    if (isMainThread) {
      const unprovide = ds.record.provide(`^([^:]+):monitor\\.([^?]+)[?]?`, (key) => {
        const [, id, prop] = key.match(/^([^:]+):monitor\.([^?]+)[?]?/)

        if (id === serviceName) {
          // TODO (fix): If id === serviceName check if there are multiple instances.
          return monitorProviders[prop + '$']
        }

        if (id === serviceInstanceId) {
          return monitorProviders[prop + '$']
        }
      })

      appDestroyers.push(() => {
        if (unprovide) {
          unprovide()
        }
      })
    }
  }

  if (appConfig.trace && isProduction) {
    const traceConfig = { ...appConfig.trace, ...config.trace }
    if (traceConfig.url) {
      trace = makeTrace({ ...traceConfig, destroyers: appDestroyers, logger, serviceName })
    }
  }

  if (appConfig.http) {
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
          .filter(Boolean),
      )

      server = createServer(
        typeof appConfig.http === 'object' ? appConfig.http : {},
        { ds, couch, config: httpConfig, logger },
        middleware,
      )

      server.listen(port)

      appDestroyers.push(() => new Promise((resolve) => server.close(resolve)))
    }
  }

  return {
    ds,
    nxt,
    logger,
    toobusy,
    destroyers,
    couch,
    server,
    config,
    compiler,
    trace,
    tracer: trace,
    userAgent,
    serviceName,
    serviceModule,
    serviceVersion,
    serviceInstanceId,
    signal: ac.signal,
  }
}
