const serializers = require('pino-std-serializers')
const { SIGNALS } = require('./platform.js')

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

module.exports = {
  err: (err) => {
    // TODO (fix): Merge with errors/serializeError?

    if (Buffer.isBuffer(err)) {
      err = new Error('unexpected buffer error')
    }

    if (Array.isArray(err)) {
      err = err.length === 1 ? err[0] : new AggregateError(err)
    }

    if (err == null) {
      return undefined
    }

    const ret = serializers.err(err)

    if (ret == null) {
      return undefined
    }

    if (ret.data !== null && typeof ret.data === 'object') {
      ret.data = JSON.stringify(ret.data)
    }

    if (typeof ret.signal === 'number') {
      ret.signal = SIGNALS[ret.signal] ?? String(ret.signal)
    }

    if (typeof ret.code === 'number') {
      ret.code = String(ret.code)
    }

    return ret
  },
  res: (res) =>
    res && {
      id: res.id || res.req?.id || getHeader(res, 'request-id') || getHeader(res.req, 'request-id'),
      stats: res.stats,
      statusCode: res.statusCode || res.status,
      bytesWritten: res.bytesWritten,
      headers: getHeaders(res),
      headersSent: res.headersSent,
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
      body: typeof ures.body === 'string' ? ures.body : null,
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
      body: typeof ureq.body === 'string' ? ureq.body : null,
      bytesWritten: ureq.bytesWritten,
      headers: getHeaders(ureq),
      query: ureq.query,
    }
  },
}
