const createError = require('http-errors')
const net = require('net')

// This expression matches hop-by-hop headers.
// These headers are meaningful only for a single transport-level connection,
// and must not be retransmitted by proxies or cached.
const HOP_EXPR =
  /^(te|host|upgrade|trailers|connection|keep-alive|http2-settings|transfer-encoding|proxy-connection|proxy-authenticate|proxy-authorization)$/i

// Removes hop-by-hop and pseudo headers.
// Updates via and forwarded headers.
// Only hop-by-hop headers may be set using the Connection general header.
module.exports.reduceHeaders = function reduceHeaders(
  { id, headers, proxyName, httpVersion, socket },
  fn,
  acc
) {
  let via
  let forwarded
  let host
  let authority
  let connection

  const entries = Object.entries(headers)

  for (const [key, val] of entries) {
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
  }

  let remove
  if (connection && !HOP_EXPR.test(connection)) {
    remove = connection.split(/,\s*/)
  }

  for (const [key, val] of entries) {
    if (key.charAt(0) !== ':' && !remove?.includes(key) && !HOP_EXPR.test(key)) {
      acc = fn(acc, key, val)
    }
  }

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
        ].join(';')
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
    via += `${httpVersion} ${proxyName}`
  }

  if (via) {
    acc = fn(acc, 'via', via)
  }

  if (id) {
    acc = fn(acc, 'request-id', id)
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
