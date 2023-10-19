const assert = require('assert')
const { findHeader } = require('../utils')
const { isDisturbed, parseURL } = require('../utils')

const redirectableStatusCodes = [300, 301, 302, 303, 307, 308]

class Handler {
  constructor(opts, { dispatch, handler }) {
    this.dispatch = dispatch
    this.handler = handler
    this.opts = opts
    this.abort = null
    this.aborted = false
    this.reason = null

    this.count = 0
    this.location = null

    this.handler.onConnect((reason) => {
      this.aborted = true
      if (this.abort) {
        this.abort(reason)
      } else {
        this.reason = reason
      }
    })
  }

  onConnect(abort) {
    if (this.aborted) {
      abort(this.reason)
    } else {
      this.abort = abort
    }
  }

  onUpgrade(statusCode, headers, socket) {
    this.handler.onUpgrade(statusCode, headers, socket)
  }

  onError(error) {
    this.handler.onError(error)
  }

  onHeaders(statusCode, headers, resume, statusText) {
    if (redirectableStatusCodes.indexOf(statusCode) === -1) {
      return this.handler.onHeaders(statusCode, headers, resume, statusText)
    }

    if (isDisturbed(this.opts.body)) {
      throw new Error(`Disturbed request cannot be redirected.`)
    }

    this.location = findHeader(headers, 'location')

    if (!this.location) {
      throw new Error(`Missing redirection location.`)
    }

    this.count += 1

    if (typeof this.opts.follow === 'function') {
      if (!this.opts.follow(this.location, this.count)) {
        return this.handler.onHeaders(statusCode, headers, resume, statusText)
      }
    } else {
      const maxCount = this.opts.follow.count ?? 0

      if (this.count >= maxCount) {
        throw new Error(`Max redirections reached: ${maxCount}.`)
      }
    }

    const { origin, pathname, search } = parseURL(
      new URL(this.location, this.opts.origin && new URL(this.opts.path, this.opts.origin)),
    )
    const path = search ? `${pathname}${search}` : pathname

    // Remove headers referring to the original URL.
    // By default it is Host only, unless it's a 303 (see below), which removes also all Content-* headers.
    // https://tools.ietf.org/html/rfc7231#section-6.4
    this.opts = {
      ...this.opts,
      headers: cleanRequestHeaders(
        this.opts.headers,
        statusCode === 303,
        this.opts.origin !== origin,
      ),
      path,
      origin,
      query: null,
    }

    // https://tools.ietf.org/html/rfc7231#section-6.4.4
    // In case of HTTP 303, always replace method to be either HEAD or GET
    if (statusCode === 303 && this.opts.method !== 'HEAD') {
      this.opts = { ...this.opts, method: 'GET', body: null }
    }
  }

  onData(chunk) {
    if (this.location) {
      /*
        https://tools.ietf.org/html/rfc7231#section-6.4

        TLDR: undici always ignores 3xx response bodies.

        Redirection is used to serve the requested resource from another URL, so it is assumes that
        no body is generated (and thus can be ignored). Even though generating a body is not prohibited.

        For status 301, 302, 303, 307 and 308 (the latter from RFC 7238), the specs mention that the body usually
        (which means it's optional and not mandated) contain just an hyperlink to the value of
        the Location response header, so the body can be ignored safely.

        For status 300, which is "Multiple Choices", the spec mentions both generating a Location
        response header AND a response body with the other possible location to follow.
        Since the spec explicitily chooses not to specify a format for such body and leave it to
        servers and browsers implementors, we ignore the body as there is no specified way to eventually parse it.
      */
    } else {
      return this.handler.onData(chunk)
    }
  }

  onComplete(trailers) {
    if (this.location) {
      /*
        https://tools.ietf.org/html/rfc7231#section-6.4

        TLDR: undici always ignores 3xx response trailers as they are not expected in case of redirections
        and neither are useful if present.

        See comment on onData method above for more detailed informations.
      */

      this.location = null

      this.dispatch(this.opts, this)
    } else {
      this.handler.onComplete(trailers)
    }
  }

  onBodySent(chunk) {
    if (this.handler.onBodySent) {
      this.handler.onBodySent(chunk)
    }
  }
}

// https://tools.ietf.org/html/rfc7231#section-6.4.4
function shouldRemoveHeader(header, removeContent, unknownOrigin) {
  return (
    (header.length === 4 && header.toString().toLowerCase() === 'host') ||
    (removeContent && header.toString().toLowerCase().indexOf('content-') === 0) ||
    (unknownOrigin &&
      header.length === 13 &&
      header.toString().toLowerCase() === 'authorization') ||
    (unknownOrigin && header.length === 6 && header.toString().toLowerCase() === 'cookie')
  )
}

// https://tools.ietf.org/html/rfc7231#section-6.4
function cleanRequestHeaders(headers, removeContent, unknownOrigin) {
  const ret = []
  if (Array.isArray(headers)) {
    for (let i = 0; i < headers.length; i += 2) {
      if (!shouldRemoveHeader(headers[i], removeContent, unknownOrigin)) {
        ret.push(headers[i], headers[i + 1])
      }
    }
  } else if (headers && typeof headers === 'object') {
    for (const key of Object.keys(headers)) {
      if (!shouldRemoveHeader(key, removeContent, unknownOrigin)) {
        ret.push(key, headers[key])
      }
    }
  } else {
    assert(headers == null, 'headers must be an object or an array')
  }
  return ret
}

module.exports = (dispatch) => (opts, handler) =>
  opts.follow ? dispatch(opts, new Handler(opts, { handler, dispatch })) : dispatch(opts, handler)
