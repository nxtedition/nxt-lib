function isDisturbed(body) {
  return !(body == null || typeof body === 'string' || Buffer.isBuffer(body))
}

function parseContentRange(range) {
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

  return { start, end: end ? end + 1 : size, size }
}

function findHeader(rawHeaders, name) {
  const len = name.length

  for (let i = 0; i < rawHeaders.length; i += 2) {
    const key = rawHeaders[i + 0]
    if (key.length === len && key.toString().toLowerCase() === name) {
      return rawHeaders[i + 1].toString()
    }
  }
  return null
}

function retryAfter(err, retryCount, opts) {
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

function parseURL(url) {
  if (typeof url === 'string') {
    url = new URL(url)

    if (!/^https?:/.test(url.origin || url.protocol)) {
      throw new Error('Invalid URL protocol: the URL must start with `http:` or `https:`.')
    }

    return url
  }

  if (!url || typeof url !== 'object') {
    throw new Error('Invalid URL: The URL argument must be a non-null object.')
  }

  if (url.port != null && url.port !== '' && !Number.isFinite(parseInt(url.port))) {
    throw new Error(
      'Invalid URL: port must be a valid integer or a string representation of an integer.',
    )
  }

  if (url.path != null && typeof url.path !== 'string') {
    throw new Error('Invalid URL path: the path must be a string or null/undefined.')
  }

  if (url.pathname != null && typeof url.pathname !== 'string') {
    throw new Error('Invalid URL pathname: the pathname must be a string or null/undefined.')
  }

  if (url.hostname != null && typeof url.hostname !== 'string') {
    throw new Error('Invalid URL hostname: the hostname must be a string or null/undefined.')
  }

  if (url.origin != null && typeof url.origin !== 'string') {
    throw new Error('Invalid URL origin: the origin must be a string or null/undefined.')
  }

  if (!/^https?:/.test(url.origin || url.protocol)) {
    throw new Error('Invalid URL protocol: the URL must start with `http:` or `https:`.')
  }

  if (!(url instanceof URL)) {
    const port = url.port != null ? url.port : url.protocol === 'https:' ? 443 : 80
    let origin = url.origin != null ? url.origin : `${url.protocol}//${url.hostname}:${port}`
    let path = url.path != null ? url.path : `${url.pathname || ''}${url.search || ''}`

    if (origin.endsWith('/')) {
      origin = origin.substring(0, origin.length - 1)
    }

    if (path && !path.startsWith('/')) {
      path = `/${path}`
    }
    // new URL(path, origin) is unsafe when `path` contains an absolute URL
    // From https://developer.mozilla.org/en-US/docs/Web/API/URL/URL:
    // If first parameter is a relative URL, second param is required, and will be used as the base URL.
    // If first parameter is an absolute URL, a given second param will be ignored.
    url = new URL(origin + path)
  }

  return url
}

function parseOrigin(url) {
  url = module.exports.parseURL(url)

  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('invalid url')
  }

  return url
}

module.exports = {
  isDisturbed,
  parseContentRange,
  findHeader,
  retryAfter,
  parseURL,
  parseOrigin,
}
