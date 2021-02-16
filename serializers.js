module.exports = {
  err: err => {
    if (!err) {
      return
    }

    let obj
    if (typeof err === 'string') {
      obj = {
        message: err
      }
    } else if (typeof err === 'object') {
      obj = {
        type: err.constructor.name,
        message: err.message,
        stack: err.stack,
        data: err.data != null ? JSON.stringify(err.data, undefined, 2) : undefined
      }

      for (const key in err) {
        const val = err[key]
        if (obj[key] === undefined && typeof val !== 'object') {
          obj[key] = val
        }
      }
    } else {
      obj = {
        message: 'invalid error'
      }
    }

    return obj
  },
  res: res => res && {
    id: (
      res.id ||
      res.req?.id ||
      (typeof res.getHeader === 'function' && res.getHeader('request-id')) ||
      (res.headers && typeof res.headers === 'object' && res.headers['request-id']) ||
      (res.req.headers && typeof res.req.headers === 'object' && res.req.headers['request-id'])
    ),
    statusCode: res.statusCode || res.status,
    bytesWritten: res.bytesWritten,
    headers: typeof res.getHeaders === 'function' ? res.getHeaders() : res.headers
  },
  req: req => req && {
    id: (
      req.id ||
      (req.headers && typeof req.headers === 'object' && req.headers['request-id'])
    ),
    method: req.method,
    url: req.url,
    headers: req.headers,
    bytesRead: req.bytesRead,
    remoteAddress: req.socket?.remoteAddress,
    remotePort: req.socket?.remotePort
  },
  ures: ures => ures && {
    id: (
      ures.id ||
      (ures.headers && typeof ures.headers === 'object' && ures.headers['request-id']) ||
      (typeof ures.getHeader === 'function' && ures.getHeader('request-id'))
    ),
    statusCode: ures.statusCode,
    bytesRead: ures.bytesRead,
    headers: (
      (typeof ures.headers === 'object' && ures.headers) ||
      (typeof ures.getHeaders === 'function' ? ures.getHeaders() : ures.headers)
    )
  },
  ureq: ureq => ureq && {
    id: (
      ureq.id ||
      (ureq.headers && typeof ureq.headers === 'object' && ureq.headers['request-id'])
    ),
    method: ureq.method,
    url: ureq.origin
      ? `${ureq.origin}${ureq.path || ''}`
      : ureq.hostname
        ? `${ureq.protocol || 'http:'}//${ureq.hostname}:${ureq.port || { 'http:': 80, 'https:': 443 }[ureq.protocol]}${ureq.path || ''}`
        : undefined,
    bytesWritten: ureq.bytesWritten,
    headers: ureq.headers
  }
}
