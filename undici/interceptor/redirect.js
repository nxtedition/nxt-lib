const { RedirectHandler } = require('undici')

class Handler extends RedirectHandler {
  constructor(opts, { dispatch, handler }) {
    super(dispatch, opts.follow.count ?? 8, opts, handler)

    this.connected = false
    this.aborted = false
    this.reason = null

    handler.onConnect((reason) => {
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
}

module.exports = (dispatch) => (opts, handler) =>
  opts.follow ? dispatch(opts, new Handler(opts, { handler, dispatch })) : dispatch(opts, handler)
