const { isDisturbed, retry: retryFn } = require('../utils.js')

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

  onUpgrade(statusCode, rawHeaders, socket) {
    return this.handler.onUpgrade(statusCode, rawHeaders, socket)
  }

  onBodySent(chunk) {
    return this.handler.onBodySent(chunk)
  }

  onHeaders(statusCode, rawHeaders, resume, statusMessage) {
    this.aborted = true
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

    const retryPromise = retryFn(err, this.count++, this.opts)
    if (retryPromise == null) {
      return this.handler.onError(err)
    }

    retryPromise
      .then(() => {
        this.timeout = null
        try {
          this.dispatch(this.opts, this)
        } catch (err2) {
          this.handler.onError(err)
        }
      })
      .catch((err) => {
        this.handler.onError(err)
      })

    this.opts.loggerdebug('retrying response')
  }
}

module.exports = (dispatch) => (opts, handler) =>
  opts.idempotent && opts.retry
    ? dispatch(opts, new Handler(opts, { handler, dispatch }))
    : dispatch(opts, handler)
