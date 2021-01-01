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
        data: JSON.stringify(err.data, undefined, 2)
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
    id: res.id || (res.req && res.req.id),
    statusCode: res.statusCode,
    bytesWritten: res.bytesWritten,
    headers: typeof res.getHeaders === 'function' ? res.getHeaders() : res.headers
  },
  req: req => req && {
    id: req.id || (req.headers && req.headers['request-id']),
    method: req.method,
    url: req.url,
    headers: req.headers,
    bytesRead: req.bytesRead,
    remoteAddress: req.socket && req.socket.remoteAddress,
    remotePort: req.socket && req.socket.remotePort
  },
  ures: ures => ures && {
    id: ures.id || (ures.req && ures.req.id),
    statusCode: ures.statusCode,
    bytesRead: ures.bytesRead,
    headers: ures.rawHeaders ? undefined : typeof ures.getHeaders === 'function' ? ures.getHeaders() : ures.headers,
    rawheaders: ures.rawHeaders
  },
  ureq: ureq => ureq && {
    id: ureq.id || (ureq.headers && ureq.headers['request-id']),
    method: ureq.method,
    url: ureq.origin
      ? `${ureq.origin}${ureq.path || ''}`
      : ureq.hostname
        ? `${ureq.protocol || 'http:'}//${ureq.hostname}:${ureq.port || { 'http:': 80, 'https:': 443 }[ureq.protocol]}${ureq.path || ''}`
        : undefined,
    timeout: ureq.timeout || ureq.requestTimeout,
    bytesWritten: ureq.bytesWritten,
    headers: ureq.headers ? undefined : ureq.headers,
    rawheaders: ureq.rawHeaders
  }
}
