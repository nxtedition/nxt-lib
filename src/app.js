module.exports = function (config, onTerminate) {
  let logger
  let ds
  let toobusy

  if (config.logger) {
    const { createLogger } = require('./logger')
    logger = createLogger(config.logger, onTerminate)
    if (config.id) {
      logger = logger.child({ name: config.id })
    }
  }

  if (config.toobusy) {
    toobusy = require('toobusy-js')
    toobusy.onLag(currentLag => logger.warn({ currentLag }, 'lag'))
  }

  if (config.deepstream) {
    const deepstream = require('@nxtedition/deepstream.io-client-js')
    const cacheDb = config.deepstream.cache ? require('leveldown')(config.deepstream.cache) : null
    const xuid = require('xuid')
    const fsp = require('fs').promises
    const fs = require('fs')
    const stream = require('stream')
    const pipeline = require('util').promisify(stream.pipeline)
    const os = require('os')

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

        logger[level]({ connectionState }, 'Deepstream Connection State Changed.')
      })
      .on('error', err => {
        logger.error({ err }, 'Deepstream Error.')
      })

    ds.rpc.provide(`${config.isProduction ? os.hostname() : module}.dump`, async () => {
      const path = `./${Date.now()}.subscriptions`
      const tmpPath = path + '.' + xuid()
      await pipeline(
        stream.Readable.from(ds.record._records.entries()),
        stream.Transform({
          objectMode: true,
          transform ([key, val], encoding, callback) {
            callback(null, `${key} ${val.version} ${val.state}`)
          }
        }),
        fs.createWriteStream(tmpPath)
      )
      await fsp.rename(tmpPath, path)
    })
  }

  if (config.stats) {
    const v8 = require('v8')

    const _log = (stats) => {
      logger.debug({
        ds: ds.stats,
        memory: process.memoryUsage(),
        v8: {
          heapSpace: v8.getHeapSpaceStatistics(),
          heap: v8.getHeapStatistics()
        },
        ...stats
      }, 'STATS')
    }

    if (config.stats.subscribe) {
      config.stats.subscribe(_log)
    } else {
      setInterval(() => _log(config.stats), config.statsInterval || 10e3)
    }
  }

  return { ds, logger, toobusy }
}
