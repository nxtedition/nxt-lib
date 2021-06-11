const rxjs = require('rxjs')
const rx = require('rxjs/operators')

class AbortError extends Error {
  constructor() {
    super('The operation was aborted')
    this.code = 'ABORT_ERR'
    this.name = 'AbortError'
  }
}

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
