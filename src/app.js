const { createLogger } = require('./logger')

module.exports = function (config, onTerminate) {
  const logger = createLogger(config.logger, onTerminate)

  let ds
  if (config.deepstream) {
    const deepstream = require('@nxtedition/deepstream.io-client-js')
    ds = deepstream(config.deepstream.url, {
      ...config.deepstream,
      cacheDb: config.deepstream.cache ? require('leveldown')(config.deepstream.cache) : null
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
