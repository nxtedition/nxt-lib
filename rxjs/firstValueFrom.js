const rx = require('rxjs/operators')
const withAbortSignal = require('./withAbortSignal')

module.exports = function firstValueFrom(x$, config) {
  const hasConfig = config && typeof config === 'object'
  const signal = hasConfig ? config.signal : undefined
  const timeout = hasConfig ? config.timeout : undefined

  if (signal) {
    x$ = x$.pipe(withAbortSignal(signal))
  }

  if (timeout) {
    x$ = x$.pipe(rx.timeout(timeout))
  }

  return x$.pipe(rx.first(hasConfig ? config.defaultValue : undefined)).toPromise()
}
