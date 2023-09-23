module.exports.isDisturbed = function isDisturbed(body) {
  return !(body == null || typeof body === 'string' || Buffer.isBuffer(body))
}

module.exports.parseContentRange = function parseContentRange(range) {
  if (typeof range !== 'string') {
    return null
  }

  const m = range.match(/^bytes (\d+)-(\d+)?\/(\d+|\*)$/)
  if (!m) {
    return null
  }

  const start = m[1] == null ? null : Number(m[1])
  if (!Number.isFinite(start)) {
    return null
  }

  const end = m[2] == null ? null : Number(m[2])
  if (end !== null && !Number.isFinite(end)) {
    return null
  }

  const size = m[2] === '*' ? null : Number(m[2])
  if (size !== null && !Number.isFinite(size)) {
    return null
  }

  return { start, end: end + 1, size }
}

module.exports.findHeader = function findHeader(rawHeaders, name) {
  const len = name.length

  for (let i = 0; i < rawHeaders.length; i += 2) {
    const key = rawHeaders[i + 0]
    if (key.length === len && key.toString().toLowerCase() === name) {
      return rawHeaders[i + 1].toString()
    }
  }
  return null
}

module.exports.retryAfter = function retryAfter(err, retryCount, opts) {
  if (opts.retry === null || opts.retry === false) {
    return null
  }

  if (typeof opts.retry === 'function') {
    const ret = opts.retry(err, retryCount)
    if (ret != null) {
      return ret
    }
  }

  const retryMax = opts.retry?.count ?? opts.maxRetries ?? 8

  if (retryCount > retryMax) {
    return null
  }

  if (err.statusCode && [420, 429, 502, 503, 504].includes(err.statusCode)) {
    const retryAfter = err.headers['retry-after'] ? err.headers['retry-after'] * 1e3 : null
    return retryAfter ?? Math.min(10e3, retryCount * 1e3)
  }

  if (
    err.code &&
    [
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'ENETDOWN',
      'ENETUNREACH',
      'EHOSTDOWN',
      'EHOSTUNREACH',
      'EPIPE',
    ].includes(err.code)
  ) {
    return Math.min(10e3, retryCount * 1e3)
  }

  if (err.message && ['other side closed'].includes(err.message)) {
    return Math.min(10e3, retryCount * 1e3)
  }

  return null
}
