const rxjs = require('rxjs')
const rx = require('rxjs/operators')
const { AbortError } = require('../errors')

module.exports = function firstValueFrom(x$, config) {
  const hasConfig = config && typeof config === 'object'
  const signal = hasConfig ? config.signal : undefined
  const timeout = hasConfig ? config.timeout : undefined

  if (signal) {
    x$ = signal.aborted ? rxjs.EMPTY : x$.pipe(rx.takeUntil(rxjs.fromEvent(signal, 'abort')))
    x$ = x$.pipe(rx.throwIfEmpty(() => new AbortError()))
  }

  if (timeout) {
    x$ = x$.pipe(rx.timeout(timeout))
  }

  return x$.pipe(rx.first(hasConfig ? config.defaultValue : undefined)).toPromise()
}
