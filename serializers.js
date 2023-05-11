function getHeader(obj, key) {
  return obj?.headers?.get?.(key) || obj?.getHeader?.(key) || obj?.headers?.[key]
}

function getHeaders(obj) {
  if (!obj) {
    return undefined
  }

  if (Array.isArray(obj.headers)) {
    const src = obj.headers
    const dst = {}
    for (let n = 0; n < src.length; n += 2) {
      const key = src[n].toString().toLowerCase()
      const val = src[n + 1].toString()
      dst[key] = dst[key] ? `${dst[key]},${val}` : val
    }
    return dst
  }

  return (
    (obj.headers?.entries && Object.fromEntries(obj.headers.entries())) ||
    obj.headers ||
    obj.getHeaders?.()
  )
}

const isErrorLike = (err) => {
  return err && typeof err.message === 'string'
}

const getErrorCause = (err) => {
  if (!err) {
    return
  }

  const cause = err.cause

  if (typeof cause === 'function') {
    const causeResult = err.cause()
    return isErrorLike(causeResult) ? causeResult : undefined
  } else {
    return isErrorLike(cause) ? cause : undefined
  }
}

const _stackWithCauses = (err, seen) => {
  if (!isErrorLike(err)) {
    return ''
  }

  const stack = err.stack || ''

  // Ensure we don't go circular or crazily deep
  if (seen.has(err)) {
    return stack + '\ncauses have become circular...'
  }

  const cause = getErrorCause(err)

  if (cause) {
    seen.add(err)
    return stack + '\ncaused by: ' + _stackWithCauses(cause, seen)
  } else {
    return stack
  }
}

const stackWithCauses = (err) => _stackWithCauses(err, new Set())

const _messageWithCauses = (err, seen, skip) => {
  if (!isErrorLike(err)) {
    return ''
  }

  const message = skip ? '' : err.message || ''

  // Ensure we don't go circular or crazily deep
  if (seen.has(err)) {
    return message + ': ...'
  }

  const cause = getErrorCause(err)

  if (cause) {
    seen.add(err)

    const skipIfVErrorStyleCause = typeof err.cause === 'function'

    return (
      message +
      (skipIfVErrorStyleCause ? '' : ': ') +
      _messageWithCauses(cause, seen, skipIfVErrorStyleCause)
    )
  } else {
    return message
  }
}

const messageWithCauses = (err) => _messageWithCauses(err, new Set())

const { toString } = Object.prototype
const seen = Symbol('circular-ref-tag')
const rawSymbol = Symbol('pino-raw-err-ref')
const pinoErrProto = Object.create(
  {},
  {
    type: {
      enumerable: true,
      writable: true,
      value: undefined,
    },
    message: {
      enumerable: true,
      writable: true,
      value: undefined,
    },
    stack: {
      enumerable: true,
      writable: true,
      value: undefined,
    },
    aggregateErrors: {
      enumerable: true,
      writable: true,
      value: undefined,
    },
    raw: {
      enumerable: false,
      get: function () {
        return this[rawSymbol]
      },
      set: function (val) {
        this[rawSymbol] = val
      },
    },
  }
)
Object.defineProperty(pinoErrProto, rawSymbol, {
  writable: true,
  value: {},
})

function errSerializer(err) {
  if (typeof err === 'string') {
    err = new Error(err)
  } else if (Array.isArray(err)) {
    err = new AggregateError(err)
  } else if (typeof err !== 'object') {
    err = Object.assign(new Error('invalid error object'), { data: JSON.stringify(err) })
  }

  if (!isErrorLike(err)) {
    return err
  }

  err[seen] = undefined // tag to prevent re-looking at this
  const _err = Object.create(pinoErrProto)
  _err.type =
    toString.call(err.constructor) === '[object Function]' ? err.constructor.name : err.name
  _err.message = messageWithCauses(err)
  _err.stack = stackWithCauses(err)

  if (Array.isArray(err.errors)) {
    _err.aggregateErrors = err.errors.map((err) => errSerializer(err))
  }

  for (const key in err) {
    if (_err[key] === undefined) {
      const val = err[key]
      if (isErrorLike(val)) {
        // We append cause messages and stacks to _err, therefore skipping causes here
        if (key !== 'cause' && !Object.prototype.hasOwnProperty.call(val, seen)) {
          _err[key] = errSerializer(val)
        }
      } else {
        _err[key] = val
      }
    }
  }

  delete err[seen] // clean up tag in case err is serialized again later
  _err.raw = err
  return _err
}

module.exports = {
  err: (err) => errSerializer(err),
  res: (res) =>
    res && {
      id: res.id || res.req?.id || getHeader(res, 'request-id') || getHeader(res.req, 'request-id'),
      stats: res.stats,
      statusCode: res.statusCode || res.status,
      bytesWritten: res.bytesWritten,
      headers: getHeaders(res),
    },
  socket: (socket) =>
    socket && {
      id: socket.id || null,
      version: socket.version ?? null,
      user: socket.user ?? null,
      userAgent: socket.userAgent ?? null,
      remoteAddress: socket.remoteAddress ?? null,
      headers: socket.headers,
    },
  req: (req) =>
    req && {
      id: req.id || getHeader(req, 'request-id'),
      method: req.method,
      url: req.url,
      headers: getHeaders(req),
      bytesRead: req.bytesRead,
      remoteAddress: req.socket?.remoteAddress,
      remotePort: req.socket?.remotePort,
    },
  ures: (ures) =>
    ures && {
      id: ures.id || getHeader(ures, 'request-id') || getHeader(ures.req, 'request-id'),
      statusCode: ures.statusCode ?? ures.status,
      bytesRead: ures.bytesRead,
      headers: getHeaders(ures),
    },
  ureq: (ureq) => {
    if (!ureq) {
      return
    }

    const url = ureq.url?.href
      ? ureq.url.href
      : typeof ureq.url === 'string'
      ? ureq.url
      : ureq.origin
      ? `${ureq.origin}${ureq.path || ''}`
      : ureq.hostname
      ? `${ureq.protocol || 'http:'}//${ureq.hostname}:${
          ureq.port || { 'http:': 80, 'https:': 443 }[ureq.protocol]
        }${ureq.path || ''}`
      : ureq.path || ureq.pathname

    return {
      id: ureq.id || getHeader(ureq, 'request-id'),
      method: ureq.method,
      url,
      bytesWritten: ureq.bytesWritten,
      headers: getHeaders(ureq),
      query: ureq.query,
    }
  },
}
