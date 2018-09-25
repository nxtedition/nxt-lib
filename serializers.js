module.exports = {
  err: err => {
    const obj = {
      type: err.constructor.name,
      message: err.message,
      stack: err.stack
    }

    for (var key in err) {
      const val = err[key]
      if (obj[key] === undefined && typeof val !== 'object') {
        obj[key] = val
      }
    }

    return obj
  },
  res: res => ({
    statusCode: res.statusCode,
    bytesWritten: res.bytesWritten,
    headers: typeof res.getHeaders === 'function' ? res.getHeaders() : res.headers
  }),
  req: req => ({
    id: req.id,
    method: req.method,
    url: req.url,
    headers: req.headers,
    bytesRead: req.bytesRead,
    remoteAddress: req.socket && req.socket.remoteAddress,
    remotePort: req.socket && req.socket.remotePort
  })
}
