class Handler {
  constructor(opts, { handler }) {
    this.handler = handler
    this.signal = opts.signal
    this.abort = null
  }

  onConnect(abort) {
    this.abort = () => abort(this.signal.reason)
    this.signal.addEventListener('abort', this.abort)

    if (this.signal.aborted) {
      abort(this.signal.reason)
    } else {
      this.handler.onConnect(abort)
    }
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
    this.signal.removeEventListener('abort', this.abort)
    return this.handler.onComplete(rawTrailers)
  }

  onError(err) {
    this.signal.removeEventListener('abort', this.abort)
    return this.handler.onError(err)
  }
}

module.exports = (dispatch) => (opts, handler) =>
  opts.signal ? dispatch(opts, new Handler(opts, { handler })) : dispatch(opts, handler)
