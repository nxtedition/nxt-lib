module.exports = class DumpHandler {
  constructor(opts, { handler }) {
    this.handler = handler
    this.position = 0
  }

  onConnect(abort) {
    this.abort = abort
    this.onConnect(abort)
  }

  onHeaders(statusCode, rawHeaders, resume, statusMessage) {
    return this.onHeaders(statusCode, rawHeaders, resume, statusMessage)
  }

  onData(chunk) {
    this.position += chunk.length

    if (this.position > 128 * 1024) {
      this.abort()
      return false
    } else {
      return this.handler.onData(chunk)
    }
  }

  onComplete(rawTrailers) {
    this.handler.onComplete(rawTrailers)
  }

  onError(err) {
    this.handler.onError(err)
  }
}
