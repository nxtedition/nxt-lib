const rxjs = require('rxjs')
const rx = require('rxjs/operators')
const { AbortError } = require('../errors')

function firstValueFrom(config) {
  const hasConfig = config && typeof config === 'object'
  const signal = hasConfig ? config.signal : undefined

  let x$ = this

  if (signal) {
    x$ = signal.aborted ? rxjs.EMPTY : x$.pipe(rx.takeUntil(rxjs.fromEvent('abort', signal)))
    x$ = x$.pipe(rx.throwIfEmpty(() => new AbortError()))
  }

  return x$.pipe(rx.first(hasConfig ? config.defaultValue : undefined)).toPromise()
}

rxjs.Observable.prototype.firstValueFrom = firstValueFrom

module.exports = (config) => (o) => firstValueFrom.call(o, config)
