const { AbortError } = require('../../errors')

class Handler {
  constructor(opts, { handler }) {
    this.handler = handler
    this.pos = 0
    this.reason = null
    this.resume = null
  }

  onConnect(abort) {
    this.abort = abort
    this.handler.onConnect((reason) => {
      this.reason = reason ?? new AbortError()
      this.resume?.()
    })
  }

  onBodySent(chunk) {
    return this.handler.onBodySent(chunk)
  }

  onHeaders(statusCode, rawHeaders, resume, statusMessage) {
    if (this.reason == null) {
      this.resume = resume
      return this.handler.onHeaders(statusCode, rawHeaders, resume, statusMessage)
    }

    return true
  }

  onData(chunk) {
    if (this.reason == null) {
      return this.handler.onData(chunk)
    }

    this.pos += chunk.length
    if (this.pos < 128 * 1024) {
      return true
    }

    this.abort(this.reason)

    return false
  }

  onComplete(rawTrailers) {
    return this.reason == null
      ? this.handler.onComplete(rawTrailers)
      : this.handler.onError(this.reason)
  }

  onError(err) {
    return this.handler.onError(err)
  }
}

module.exports = (dispatch) => (opts, handler) => dispatch(opts, new Handler(opts, { handler }))
