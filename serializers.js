const seen = Symbol('circular-ref-tag')

function getHeader(obj, key) {
  return (
    obj?.headers?.get?.('request-id') ||
    obj?.getHeader?.('request-id') ||
    obj?.headers?.['request-id']
  )
}

function getHeaders(obj) {
  return (
    (obj.headers?.entries && Object.fromEntries(obj.headers.entries())) ||
    obj.headers ||
    obj.getHeaders?.()
  )
}

module.exports = {
  err: (err) => serializeError(err),
  res: (res) =>
    res && {
      id: res.id || res.req?.id || getHeader(res, 'request-id') || getHeader(res.req, 'request-id'),
      stats: res.stats,
      statusCode: res.statusCode || res.status,
      bytesWritten: res.bytesWritten,
      headers: getHeaders(res),
    },
  req: (req) =>
    req && {
      id: req.id || getHeader(req, 'request-id'),
      method: req.method,
      url: req.url,
      headers: req.headers,
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
      : undefined

    return {
      id: ureq.id || (typeof ureq?.headers === 'object' && ureq.headers['request-id']),
      method: ureq.method,
      url,
      bytesWritten: ureq.bytesWritten,
      headers: ureq.headers,
    }
  },
}

function serializeError(err) {
  if (!err) {
    return
  }

  if (typeof err === 'string') {
    err = {
      message: err,
    }
  } else if (Array.isArray(err)) {
    err = {
      errors: err,
    }
  } else if (typeof err !== 'object') {
    err = {
      message: 'invalid error',
    }
  }

  /* eslint-disable no-prototype-builtins */
  if (err.hasOwnProperty(seen)) {
    return
  }

  err[seen] = undefined // tag to prevent re-looking at this

  const obj = {
    type: err.constructor?.toString() === '[object Function]' ? err.constructor.name : err.name,
    message: err.message,
    stack: err.stack,
    data: err.data != null ? JSON.stringify(err.data, undefined, 2) : undefined,
  }

  if (Array.isArray(obj.errors)) {
    obj.errors = obj.errors.map((err) => serializeError(err)).filter(Boolean)
  }

  for (const key in err) {
    if (obj[key] !== undefined) {
      continue
    }

    obj[key] = err[key] instanceof Error ? serializeError(err[key]) : err[key]
  }

  delete err[seen]

  return obj
}
