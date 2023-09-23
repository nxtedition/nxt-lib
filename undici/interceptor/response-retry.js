const assert = require('node:assert')
const { isDisturbed, retryAfter: retryAfterFn } = require('../utils.js')

class Handler {
  constructor(opts, { dispatch, handler }) {
    this.dispatch = dispatch
    this.handler = handler
    this.opts = opts
    this.abort = null
    this.aborted = false
    this.responded = false
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
    this.responded = true
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

    if (this.responded || this.aborted || isDisturbed(this.opts.body)) {
      return this.handler.onError(err)
    }

    const retryAfter = retryAfterFn(err, this.count++, this.opts)
    if (retryAfter == null) {
      return this.handler.onError(err)
    }
    assert(Number.isFinite(retryAfter), 'invalid retryAfter')

    this.opts.logger?.debug('retrying response', { retryAfter })

    this.timeout = setTimeout(() => {
      this.timeout = null
      try {
        this.dispatch(this.opts, this)
      } catch (err2) {
        this.handler.onError(err)
      }
    }, retryAfter)
  }
}

module.exports = (dispatch) => (opts, handler) =>
  opts.idempotent && opts.retry
    ? dispatch(opts, new Handler(opts, { handler, dispatch }))
    : dispatch(opts, handler)
