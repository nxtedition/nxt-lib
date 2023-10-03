const assert = require('node:assert')
const { isDisturbed, retryAfter: retryAfterFn } = require('../utils.js')

class Handler {
  constructor(opts, { dispatch, handler }) {
    this.dispatch = dispatch
    this.handler = handler
    this.opts = opts
    this.abort = null
    this.aborted = false
    this.reason = null
    this.timeout = null
    this.count = 0
    this.retryAfter = null

    this.handler.onConnect?.((reason) => {
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

  onBodySent(chunk) {
    return this.handler.onBodySent?.(chunk)
  }

  onHeaders(statusCode, rawHeaders, resume, statusMessage) {
    this.aborted = true
    return this.handler.onHeaders?.(statusCode, rawHeaders, resume, statusMessage)
  }

  onData(chunk) {
    return this.handler.onData?.(chunk)
  }

  onComplete(rawTrailers) {
    return this.handler.onComplete?.(rawTrailers)
  }

  onError(err) {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }

    if (this.aborted || isDisturbed(this.opts.body)) {
      return this.handler.onError?.(err)
    }

    const retryAfter = retryAfterFn(err, this.count++, this.opts)
    if (retryAfter == null) {
      return this.handler.onError?.(err)
    }
    assert(Number.isFinite(retryAfter), 'invalid retryAfter')

    this.opts.logger?.debug('retrying response', { retryAfter })

    this.timeout = setTimeout(() => {
      this.timeout = null
      try {
        this.dispatch(this.opts, this)
      } catch (err2) {
        this.handler.onError?.(err)
      }
    }, retryAfter)
    this.retryAfter = null
  }
}

module.exports = (dispatch) => (opts, handler) =>
  opts.idempotent && opts.retry
    ? dispatch(opts, new Handler(opts, { handler, dispatch }))
    : dispatch(opts, handler)
