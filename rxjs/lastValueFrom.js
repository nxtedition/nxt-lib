import { EMPTY, fromEvent, takeUntil, throwIfEmpty, last } from 'rxjs'
import { AbortError } from '../errors'

export default function lastValueFrom(x$, config) {
  const hasConfig = config && typeof config === 'object'
  const signal = hasConfig ? config.signal : undefined

  if (signal) {
    x$ = signal.aborted ? EMPTY : x$.pipe(takeUntil(fromEvent(signal, 'abort')))
    x$ = x$.pipe(throwIfEmpty(() => new AbortError()))
  }

  return x$.pipe(last(hasConfig ? config.defaultValue : undefined)).toPromise()
}
