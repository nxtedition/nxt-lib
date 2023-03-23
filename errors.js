const objectHash = require('object-hash')
const fp = require('lodash/fp.js')

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

  if (Array.isArray(error)) {
    return error.map(serializeError)
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

module.exports.makeMessages = function makeMessages(error, options) {
  if (!error) {
    return []
  } else if (Array.isArray(error)) {
    return error.flatMap((error) => makeMessages(error, options))
  } else if (Array.isArray(error.messages)) {
    return error.messages.map((error) => makeMessages(error, options))
  } else if (error) {
    let err
    if (typeof error === 'string' && error) {
      err = { msg: error, id: options?.id, level: options?.level || 40, code: options?.code }
    } else if (typeof error === 'object') {
      const level = parseInt(error.level) || options?.level || 40
      const code =
        [error?.code, options?.codes?.[error?.code]].find(
          (x) => typeof x === 'string' && x.length > 0
        ) ?? undefined
      const msg =
        [error.msg, error.message, code?.toLowerCase().replace('_', ' ')].find(
          (x) => typeof x === 'string' && x.length > 0
        ) || 'unknown error'

      let data = error.data
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch {}
      }

      err = {
        msg,
        title: error.title ?? error.name,
        id: error.id ?? options?.id ?? objectHash({ msg, level, code, data: error.data }),
        level,
        code,
        data,
        index: typeof error.index === 'object' ? error.index : null,
      }
    }

    return fp.pipe(
      fp.flattenDeep,
      fp.filter(Boolean),
      fp.uniqBy('id')
    )([
      err,
      ...makeMessages(error.cause),
      ...makeMessages(error.error),
      ...makeMessages(error.errors),
      ...makeMessages(error.messages),
      ...makeMessages(error.status?.messages),
    ])
  } else {
    return []
  }
}
