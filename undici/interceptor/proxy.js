const createError = require('http-errors')
const net = require('net')

class Handler {
  constructor(opts, { handler }) {
    this.handler = handler
    this.opts = {
      ...opts,
      headers: reduceHeaders(
        {
          headers: opts.headers ?? {},
          httpVersion: opts.proxy.httpVersion ?? opts.proxy.req?.httpVersion,
          socket: opts.proxy.socket ?? opts.proxy.req?.socket,
          proxyName: opts.proxy.name,
        },
        (obj, key, val) => {
          obj[key] = val
          return obj
        },
        {},
      ),
    }
    this.abort = null
    this.aborted = false
  }

  onConnect(abort) {
    this.abort = abort
    this.handler.onConnect((reason) => {
      this.aborted = true
      this.abort(reason)
    })
  }

  onBodySent(chunk) {
    return this.handler.onBodySent(chunk)
  }

  onHeaders(statusCode, rawHeaders, resume, statusMessage) {
    return this.handler.onHeaders(
      statusCode,
      reduceHeaders(
        {
          headers: rawHeaders,
          httpVersion: this.opts.proxy.httpVersion ?? this.opts.proxy.req?.httpVersion,
          socket: null,
          proxyName: this.opts.proxy.name,
        },
        (acc, key, val) => {
          acc.push(key, val)
          return acc
        },
        [],
      ),
      resume,
      statusMessage,
    )
  }

  onData(chunk) {
    return this.handler.onData(chunk)
  }

  onComplete(rawTrailers) {
    return this.handler.onComplete(rawTrailers)
  }

  onError(err) {
    return this.handler.onError(err)
  }
}

module.exports = (dispatch) => (opts, handler) =>
  opts.proxy ? dispatch(opts, new Handler(opts, { handler })) : dispatch(opts, handler)

// This expression matches hop-by-hop headers.
// These headers are meaningful only for a single transport-level connection,
// and must not be retransmitted by proxies or cached.
const HOP_EXPR =
  /^(te|host|upgrade|trailers|connection|keep-alive|http2-settings|transfer-encoding|proxy-connection|proxy-authenticate|proxy-authorization)$/i

function forEachHeader(headers, fn) {
  if (Array.isArray(headers)) {
    for (let n = 0; n < headers.length; n += 2) {
      fn(headers[n + 0], headers[n + 1])
    }
  } else {
    for (const [key, val] of Object.entries(headers)) {
      fn(key, val)
    }
  }
}

// Removes hop-by-hop and pseudo headers.
// Updates via and forwarded headers.
// Only hop-by-hop headers may be set using the Connection general header.
function reduceHeaders({ headers, proxyName, httpVersion, socket }, fn, acc) {
  let via = ''
  let forwarded = ''
  let host = ''
  let authority = ''
  let connection = ''

  forEachHeader(headers, (key, val) => {
    const len = key.length
    if (len === 3 && !via && key.toLowerCase() === 'via') {
      via = val
    } else if (len === 4 && !host && key.toLowerCase() === 'host') {
      host = val
    } else if (len === 9 && !forwarded && key.toLowerCase() === 'forwarded') {
      forwarded = val
    } else if (len === 10 && !connection && key.toLowerCase() === 'connection') {
      connection = val
    } else if (len === 10 && !authority && key.toLowerCase() === ':authority') {
      authority = val
    }
  })

  let remove = []
  if (connection && !HOP_EXPR.test(connection)) {
    remove = connection.split(/,\s*/)
  }

  forEachHeader(headers, (key, val) => {
    if (key.charAt(0) !== ':' && !remove.includes(key) && !HOP_EXPR.test(key)) {
      acc = fn(acc, key, val)
    }
  })

  if (socket) {
    const forwardedHost = authority || host
    acc = fn(
      acc,
      'forwarded',
      (forwarded ? forwarded + ', ' : '') +
        [
          socket.localAddress && `by=${printIp(socket.localAddress, socket.localPort)}`,
          socket.remoteAddress && `for=${printIp(socket.remoteAddress, socket.remotePort)}`,
          `proto=${socket.encrypted ? 'https' : 'http'}`,
          forwardedHost && `host="${forwardedHost}"`,
        ].join(';'),
    )
  } else if (forwarded) {
    // The forwarded header should not be included in response.
    throw new createError.BadGateway()
  }

  if (proxyName) {
    if (via) {
      if (via.split(',').some((name) => name.endsWith(proxyName))) {
        throw new createError.LoopDetected()
      }
      via += ', '
    } else {
      via = ''
    }
    via += `${httpVersion ?? 'HTTP/1.1'} ${proxyName}`
  }

  if (via) {
    acc = fn(acc, 'via', via)
  }

  return acc
}

function printIp(address, port) {
  const isIPv6 = net.isIPv6(address)
  let str = `${address}`
  if (isIPv6) {
    str = `[${str}]`
  }
  if (port) {
    str = `${str}:${port}`
  }
  if (isIPv6 || port) {
    str = `"${str}"`
  }
  return str
}
