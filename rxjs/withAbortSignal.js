import { Observable } from 'rxjs'
import { AbortError } from '../errors.js'

function withAbortSignalImpl(signal) {
  return new Observable((o) => {
    o.add(this.subscribe(o))

    if (!signal) {
      return
    }

    const onAbort = () => {
      o.error(signal.reason ?? new AbortError())
    }

    if (signal.aborted) {
      onAbort()
    } else {
      signal.addEventListener('abort', onAbort)
      o.add(() => {
        signal.removeEventListener('abort', onAbort)
      })
    }
  })
}

Observable.prototype.withAbortSignal = withAbortSignalImpl

export default function withAbortSignal(signal) {
  return (o) => withAbortSignalImpl.call(o, signal)
}
