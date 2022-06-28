const serializers = require('pino-std-serializers')

function getHeader(obj, key) {
  return obj?.headers?.get?.(key) || obj?.getHeader?.(key) || obj?.headers?.[key]
}

function getHeaders(obj) {
  if (Array.isArray(obj)) {
    const headers = {}
    for (let n = 0; n < obj.length; n += 2) {
      headers[obj[n + 0]] = obj[n + 1]
    }
  }
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
      id: ureq.id || getHeader(ureq, 'request-id'),
      method: ureq.method,
      url,
      bytesWritten: ureq.bytesWritten,
      headers: ureq.headers,
      query: ureq.query,
    }
  },
}

function serializeError(err) {
  if (!err) {
    return
  }

  if (typeof err === 'string') {
    err = new Error(err)
  } else if (Array.isArray(err)) {
    err = new AggregateError(err)
  } else if (typeof err !== 'object') {
    err = Object.assign(new Error('invalid error object'), { data: JSON.stringify(err) })
  }

  return serializers.err(err)
}
