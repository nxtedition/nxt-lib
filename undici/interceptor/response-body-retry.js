const assert = require('node:assert')
const { parseContentRange, isDisturbed, findHeader } = require('../utils.js')

class Handler {
  constructor(opts, { dispatch, handler }) {
    assert(typeof opts.retry === 'function')

    this.dispatch = dispatch
    this.handler = handler
    this.opts = opts
    this.count = 0
    this.aborted = false
    this.pos = 0
    this.end = null
    this.abort = null
    this.error = null
  }

  onConnect(abort) {
    this.abort = abort
    this.handler.onConnect((reason) => {
      this.aborted = true
      this.abort(reason)
    })
  }

  onBodySent(chunk) {
    return this.handler.onBodySent(chunk)
  }

  onHeaders(statusCode, rawHeaders, resume, statusMessage) {
    try {
      if (this.resume) {
        // TODO (fix): Support other statusCode with skip?

        if (statusCode !== 206) {
          throw this.error
        }

        const contentRange = findHeader(rawHeaders, 'content-range')
        assert(contentRange, 'content-range missing')

        const { start, size, end = size } = parseContentRange(contentRange) ?? {}

        assert(this.pos === start, 'content-range mismatch')
        assert(this.end == null || this.end === end, 'content-range mismatch')

        this.resume = resume
        return true
      }

      if (this.end == null) {
        if (statusCode === 206) {
          const contentRange = findHeader(rawHeaders, 'content-range')
          assert(contentRange, 'content-range missing')

          const { start, size, end = size } = parseContentRange(contentRange) ?? {}
          this.end = end
          this.pos = Number(start)
        } else {
          const contentLength = findHeader(rawHeaders, 'content-length')
          if (contentLength) {
            this.end = Number(contentLength)
          }
        }

        assert(Number.isFinite(this.pos))
        assert(this.end == null || Number.isFinite(this.end), 'invalid content-length')
      }
    } catch (err) {
      this.aborted = true
      this.abort(err)
      return false
    }

    this.resume = resume
    return this.handler.onHeaders(statusCode, rawHeaders, () => this.resume(), statusMessage)
  }

  onData(chunk) {
    this.pos += chunk.length
    this.count = 0
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
      assert(retryAfter == null || Number.isFinite(retryAfter), 'invalid retry')
    } catch (err2) {
      return this.handler.onError(new AggregateError([err, err2]))
    }

    if (retryAfter == null) {
      return this.handler.onError(err)
    }

    this.error = err
    this.timeout = setTimeout(
      () => {
        this.timeout = null
        try {
          this.dispatch(
            {
              ...this.opts,
              headers: {
                ...this.opts.headers,
                range: `bytes=${this.pos}-${this.end ?? ''}`,
              },
            },
            this,
          )
        } catch (err2) {
          this.handler.onError(new AggregateError([err, err2]))
        }
      },
      Math.min(10e3, this.count * 1e3),
    )
  }
}

module.exports = (dispatch) => (opts, handler) => {
  return opts.idempotent && opts.retry && opts.method === 'GET'
    ? dispatch(opts, new Handler(opts, { handler, dispatch }))
    : dispatch(opts, handler)
}
