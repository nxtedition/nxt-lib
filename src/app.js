module.exports = function (config, onTerminate) {
  let logger
  let ds
  let nxt
  let toobusy

  const { createLogger } = require('./logger')

  logger = createLogger({
    ...config.logger,
    base: {
      ...config.logger.base
    }
  }, onTerminate)
  if (config.id) {
    logger = logger.child({ name: config.id })
  }

  if (config.toobusy) {
    toobusy = require('toobusy-js')
    toobusy.onLag(currentLag => logger.warn({ currentLag }, 'lag'))
  }

  if (config.deepstream) {
    config.deepstream = {
      url: 'ws://localhost:6020/deepstream',
      maxReconnectAttempts: Infinity,
      maxReconnectInterval: 10000,
      cacheSize: 2048,
      ...config.deepstream
    }
    const deepstream = require('@nxtedition/deepstream.io-client-js')
    const cacheDb = config.deepstream.cache ? require('leveldown')(config.deepstream.cache) : null
    const xuid = require('xuid')
    const fsp = require('fs').promises
    const fs = require('fs')
    const stream = require('stream')
    const pipeline = require('util').promisify(stream.pipeline)
    const os = require('os')
    const path = require('path')

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
        const username = config.deepstream.credentials.username
        logger[level]({ connectionState, username }, 'Deepstream Connection State Changed.')
      })
      .on('error', err => {
        logger.error({ err }, 'Deepstream Error.')
      })

    nxt = require('./deepstream')(ds)

    const name = `${config.isProduction ? os.hostname() : config.id}`
    ds.rpc.provide(`${name}.dump`, async () => {
      const dirName = path.join('./.nxt-dump', name, new Date().toISOString())
      await fsp.mkdir(dirName, { recursive: true })
      const pathName = path.join(dirName, 'subscriptions')
      const tmpPathName = pathName + `.${xuid()}`
      await pipeline(
        stream.Readable.from(ds.record._records.entries()),
        stream.Transform({
          objectMode: true,
          transform ([key, val], encoding, callback) {
            callback(null, `${key} ${val.version} ${val.state}`)
          }
        }),
        fs.createWriteStream(tmpPathName)
      )
      await fsp.rename(tmpPathName, pathName)
      return dirName
    })
  }

  if (config.status && config.status.subscribe && process.env.NODE_ENV === 'production') {
    const os = require('os')
    ds.nxt.record.provide(`${os.hostname()}:monitor.status`, () => config.status)
  }

  if (config.stats && process.env.NODE_ENV === 'production') {
    const v8 = require('v8')

    const _log = (stats) => {
      logger.debug({
        ds: ds.stats,
        lag: toobusy && toobusy.lag(),
        memory: process.memoryUsage(),
        v8: {
          heapSpace: v8.getHeapSpaceStatistics(),
          heap: v8.getHeapStatistics()
        },
        ...stats
      }, 'STATS')
    }

    if (config.stats.subscribe) {
      // TOOD (fix): unref?
      config.stats
        .auditTime(10e3)
        .retryWhen(err$ => err$.do(err => logger.error({ err })).delay(10e3))
        .subscribe(_log)
    } else if (typeof config.stats === 'function') {
      setInterval(() => _log(config.stats()), config.statsInterval || 10e3).unref()
    } else {
      setInterval(() => _log(config.stats), config.statsInterval || 10e3).unref()
    }
  }

  return { ds, nxt, logger, toobusy }
}
