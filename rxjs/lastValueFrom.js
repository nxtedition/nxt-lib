const rxjs = require('rxjs')
const rx = require('rxjs/operators')
const { AbortError } = require('../errors')

module.exports = function lastValueFrom(x$, config) {
  const hasConfig = config && typeof config === 'object'
  const signal = hasConfig ? config.signal : undefined

  if (signal) {
    x$ = signal.aborted ? rxjs.EMPTY : x$.pipe(rx.takeUntil(rxjs.fromEvent(signal, 'abort')))
    x$ = x$.pipe(rx.throwIfEmpty(() => new AbortError()))
  }

  return x$.pipe(rx.last(hasConfig ? config.defaultValue : undefined)).toPromise()
}
