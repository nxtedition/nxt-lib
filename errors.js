module.exports.AbortError = class AbortError extends Error {
  constructor() {
    super('The operation was aborted')
    this.code = 'ABORT_ERR'
    this.name = 'AbortError'
  }
}

module.exports.parseError = function parseError(error) {
  if (!error) {
    return null
  }

  if (typeof error === 'string') {
    throw new Error(error || 'unknown error')
  }

  if (Array.isArray(error)) {
    return new AggregateError(error.map(parseError))
  }

  const { msg, message = msg, errors, cause, data, ...properties } = error
  return Object.assign(
    Array.isArray(errors)
      ? new AggregateError(errors.map(parseError), message)
      : new Error(message || 'unknown error'),
    {
      ...properties,
      data: typeof data === 'string' ? data : JSON.stringify(data),
      cause: cause ? parseError(error.cause) : undefined,
    }
  )
}

module.exports.serializeError = function serializeError(error) {
  if (!error) {
    return null
  }

  if (typeof error === 'string') {
    return { message: error || 'unknown error' }
  }

  let {
    msg,
    message = msg,
    errors,
    code,
    cause,
    body,
    statusCode,
    status = statusCode,
    headers,
    data = body,
    ...properties
  } = error

  errors = Array.isArray(errors) ? errors.map(serializeError) : undefined
  cause = cause ? serializeError(cause) : undefined

  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {}
  }

  return JSON.parse(
    JSON.stringify({
      ...properties,
      message,
      code,
      status,
      headers,
      data,
      cause,
      errors,
    })
  )
}
