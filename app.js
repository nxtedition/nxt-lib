module.exports = function (config, onTerminate) {
  let logger
  let ds

  if (config.logger) {
    const { createLogger } = require('./logger')
    logger = createLogger(config.logger, onTerminate)
  }

  if (config.toobusy) {
    const toobusy = require('toobusy-js')
    toobusy.onLag(currentLag => logger.warn({ currentLag }, 'lag'))
  }

  if (config.deepstream) {
    const deepstream = require('@nxtedition/deepstream.io-client-js')
    const cacheDb = config.deepstream.cache ? require('leveldown')(config.deepstream.cache) : null
    if (cacheDb) {
      logger.debug({ cacheDb }, 'Deepstream Caching')
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
  }

  return { ds, logger }
}
