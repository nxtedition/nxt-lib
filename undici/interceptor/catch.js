class Handler {
  constructor(opts, { handler }) {
    this.handler = handler
  }

  onConnect(abort) {
    this.abort = abort
    try {
      return this.onConnect(abort)
    } catch (err) {
      this.abort(err)
      return false
    }
  }

  onBodySent(chunk) {
    try {
      return this.handler.onBodySent(chunk)
    } catch (err) {
      this.abort(err)
      return false
    }
  }

  onHeaders(statusCode, rawHeaders, resume, statusMessage) {
    try {
      return this.handler.onHeaders(statusCode, rawHeaders, resume, statusMessage)
    } catch (err) {
      this.abort(err)
      return false
    }
  }

  onData(chunk) {
    try {
      return this.handler.onData(chunk)
    } catch (err) {
      this.abort(err)
      return false
    }
  }

  onComplete(rawTrailers) {
    try {
      return this.handler.onComplete(rawTrailers)
    } catch (err) {
      this.abort(err)
      return false
    }
  }

  onError(err) {
    return this.handler.onError(err)
  }
}

module.exports = (dispatch) => (opts, handler) =>
  opts.dump ? dispatch(opts, new Handler(opts, { handler })) : dispatch(opts, handler)
