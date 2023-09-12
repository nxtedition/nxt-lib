const assert = require('node:assert')
const { isDisturbed } = require('../utils.js')

class Handler {
  constructor(opts, { dispatch, handler }) {
    assert(typeof opts.retry === 'function')

    this.dispatch = dispatch
    this.handler = handler
    this.opts = opts
    this.abort = null
    this.timeout = null
    this.count = 0
    this.aborted = false
    this.retryAfter = null
  }

  onConnect(abort) {
    return this.handler.onConnect((reason) => {
      this.aborted = true
      abort(reason)
    })
  }

  onBodySent(chunk) {
    return this.handler.onBodySent(chunk)
  }

  onHeaders(statusCode, rawHeaders, resume, statusMessage) {
    return this.handler.onHeaders(statusCode, rawHeaders, resume, statusMessage)
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

    if (this.aborted || isDisturbed(this.opts.body)) {
      return this.handler.onError(err)
    }

    let retryAfter
    try {
      retryAfter = this.opts.retry(err, this.count++, this.opts)
      assert(retryAfter == null || Number.isFinite(retryAfter), 'invalid retryAfter')
    } catch (err2) {
      return this.handler.onError(new AggregateError([err, err2]))
    }

    if (retryAfter == null) {
      return this.handler.onError(err)
    }

    this.timeout = setTimeout(() => {
      this.timeout = null
      try {
        this.dispatch(this.opts, this)
      } catch (err2) {
        return this.handler.onError(new AggregateError([err, err2]))
      }
    }, retryAfter)
  }
}

module.exports = (dispatch) => (opts, handler) =>
  opts.idempotent && opts.retry
    ? dispatch(opts, new Handler(opts, { handler, dispatch }))
    : dispatch(opts, handler)
