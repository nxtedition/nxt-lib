import { first, timeout as rxTimeout } from 'rxjs'
import withAbortSignal from './withAbortSignal.js'

export default function firstValueFrom(x$, config) {
  const hasConfig = config && typeof config === 'object'
  const signal = hasConfig ? config.signal : undefined
  const timeout = hasConfig ? config.timeout : undefined

  if (signal) {
    x$ = x$.pipe(withAbortSignal(signal))
  }

  if (timeout) {
    x$ = x$.pipe(rxTimeout(timeout))
  }

  return x$.pipe(first(hasConfig ? config.defaultValue : undefined)).toPromise()
}
