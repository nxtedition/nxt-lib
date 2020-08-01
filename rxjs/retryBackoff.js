const { Observable } = require('rxjs')

module.exports = Observable.prototype.retryBackoff = function retryBackoff (config) {
  const {
    initialInterval,
    maxAttempts = Infinity,
    maxInterval = Infinity,
    tap,
    shouldRetry = () => true,
    backoffDelay = _exponentialBackoffDelay
  } = (typeof config === 'number') ? { initialInterval: config } : config

  return this.retryWhen(err$ => err$.concatMap((err, i) => {
    if (tap) {
      tap(err, i)
    }
    return Observable.if(
      () => i < maxAttempts && shouldRetry(err),
      Observable.timer(_getDelay(backoffDelay(i, initialInterval), maxInterval)),
      Observable.throw(err)
    )
  }))
}

function _getDelay (backoffDelay, maxInterval) {
  return Math.min(backoffDelay, maxInterval)
}

function _exponentialBackoffDelay (iteration, initialInterval) {
  return Math.pow(2, iteration) * initialInterval
}
