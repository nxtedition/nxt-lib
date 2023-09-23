const assert = require('node:assert')
const { isDisturbed, retryAfter: retryAfterFn } = require('../utils')
const createError = require('http-errors')
const { parseHeaders } = require('../../http')

class Handler {
  constructor(opts, { dispatch, handler }) {
    this.dispatch = dispatch
    this.handler = handler
    this.opts = opts
    this.abort = null
    this.aborted = false

    this.timeout = null
    this.count = 0
    this.retryAfter = null
  }

  onConnect(abort) {
    this.retryAfter = null
    this.abort = abort
    return this.handler.onConnect((reason) => {
      this.aborted = true
      this.abort(reason)
    })
  }

  onBodySent(chunk) {
    return this.handler.onBodySent(chunk)
  }

  onHeaders(statusCode, rawHeaders, resume, statusMessage) {
    if (statusCode < 400) {
      return this.handler.onHeaders(statusCode, rawHeaders, resume, statusMessage)
    }

    const err = createError(statusCode, { headers: parseHeaders(rawHeaders) })

    const retryAfter = retryAfterFn(err, this.count++, this.opts)
    if (retryAfter == null) {
      return this.handler.onHeaders(statusCode, rawHeaders, resume, statusMessage)
    }
    assert(Number.isFinite(retryAfter), 'invalid retryAfter')

    this.retryAfter = retryAfter

    this.abort(err)

    return false
  }

  onData(chunk) {
    return this.handler.onData(chunk)
  }

  onComplete(rawTrailers) {
    return this.handler.onComplete(rawTrailers)
  }

  onError(err) {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }

    if (this.retryAfter == null || this.aborted || isDisturbed(this.opts.body)) {
      return this.handler.onError(err)
    }

    this.opts.logger?.debug('retrying response status', { retryAfter: this.retryAfter })

    this.timeout = setTimeout(() => {
      this.timeout = null
      try {
        this.dispatch(this.opts, this)
      } catch (err) {
        this.handler.onError(err)
      }
    }, this.retryAfter)
  }
}

module.exports = (dispatch) => (opts, handler) =>
  opts.idempotent && opts.retry
    ? dispatch(opts, new Handler(opts, { handler, dispatch }))
    : dispatch(opts, handler)
