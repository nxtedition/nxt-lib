const seen = Symbol('circular-ref-tag')

module.exports = {
  err: (err) => serializeError(err),
  res: (res) =>
    res && {
      id:
        res.id ||
        res.req?.id ||
        (typeof res.getHeader === 'function' && res.getHeader('request-id')) ||
        (res.headers && typeof res.headers === 'object' && res.headers['request-id']) ||
        (res.req?.headers && typeof res.req.headers === 'object' && res.req.headers['request-id']),
      stats: res.stats,
      statusCode: res.statusCode || res.status,
      bytesWritten: res.bytesWritten,
      headers: typeof res.getHeaders === 'function' ? res.getHeaders() : res.headers,
    },
  req: (req) =>
    req && {
      id: req.id || (req.headers && typeof req.headers === 'object' && req.headers['request-id']),
      method: req.method,
      url: req.url,
      headers: req.headers,
      bytesRead: req.bytesRead,
      remoteAddress: req.socket?.remoteAddress,
      remotePort: req.socket?.remotePort,
    },
  ures: (ures) =>
    ures && {
      id:
        ures.id ||
        (ures.headers && typeof ures.headers === 'object' && ures.headers['request-id']) ||
        (typeof ures.getHeader === 'function' && ures.getHeader('request-id')),
      statusCode: ures.statusCode,
      bytesRead: ures.bytesRead,
      headers:
        (typeof ures.headers === 'object' && ures.headers) ||
        (typeof ures.getHeaders === 'function' ? ures.getHeaders() : ures.headers),
    },
  ureq: (ureq) => {
    if (!ureq) {
      return
    }

    let url = ureq.url?.href
      ? ureq.url
      : typeof ureq.url === 'string'
      ? ureq.url
      : ureq.origin
      ? `${ureq.origin}${ureq.path || ''}`
      : ureq.hostname
      ? `${ureq.protocol || 'http:'}//${ureq.hostname}:${
          ureq.port || { 'http:': 80, 'https:': 443 }[ureq.protocol]
        }${ureq.path || ''}`
      : undefined

    if (!(url instanceof URL)) {
      url = new URL(url)
    }

    return {
      id:
        ureq.id || (ureq.headers && typeof ureq.headers === 'object' && ureq.headers['request-id']),
      method: ureq.method,
      url,
      path: url?.path,
      origin: url?.origin,
      hostname: url?.hostname,
      protocol: url?.protocol,
      port: url?.port,
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
