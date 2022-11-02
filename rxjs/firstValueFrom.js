const rxjs = require('rxjs')
const { AbortError } = require('../errors')

module.exports = function firstValueFrom(x$, config) {
  const hasConfig = config && typeof config === 'object'
  const signal = hasConfig ? config.signal : undefined

  if (signal) {
    x$ = signal.aborted ? rxjs.EMPTY : x$.pipe(rxjs.takeUntil(rxjs.fromEvent(signal, 'abort')))
    x$ = x$.pipe(rxjs.throwIfEmpty(() => new AbortError()))
  }

  return rxjs.firstValueFrom(x$, config)
}
