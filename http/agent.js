const undici = require('undici')
const stream = require('stream')

module.exports = class HttpAgent {
  constructor (factory = (url) => new undici.Pool(url)) {
    this._factory = factory
    this._origins = new Map()
  }

  request (url, opts, callback) {
    if (callback && typeof callback !== 'function') {
      throw new Error('invalid argument: callback')
    }

    try {
      if (typeof url === 'string') {
        url = new URL(url)
      } else if (!(url instanceof URL)) {
        throw new Error('invailid argument: url')
      }

      if (opts.path) {
        throw new Error('invalid argument: opts.path')
      }

      return getClient(this, url.origin).request({
        ...opts,
        path: `${url.pathname || ''}${url.search || ''}`
      }, callback)
    } catch (err) {
      if (typeof callback === 'function') {
        process.nextTick(callback, err)
      } else {
        return Promise.reject(err)
      }
    }
  }

  stream (url, opts, factory, callback) {
    if (callback && typeof callback !== 'function') {
      throw new Error('invalid argument: callback')
    }

    try {
      if (typeof url === 'string') {
        url = new URL(url)
      } else if (!(url instanceof URL)) {
        throw new Error('invalid argument: url')
      }

      if (opts.path) {
        throw new Error('invalid argument: opts.path')
      }

      return getClient(this, url.origin).stream({
        ...opts,
        path: `${url.pathname || ''}${url.search || ''}`
      }, factory, callback)
    } catch (err) {
      if (typeof callback === 'function') {
        process.nextTick(callback, err)
      } else {
        return Promise.reject(err)
      }
    }
  }

  pipeline (url, opts) {
    try {
      if (typeof url === 'string') {
        url = new URL(url)
      } else if (!(url instanceof URL)) {
        throw new Error('invailid argument: url')
      }

      if (opts.path) {
        throw new Error('invalid argument: opts.path')
      }

      return getClient(this, url.origin).pipeline({
        ...opts,
        path: `${url.pathname || ''}${url.search || ''}`
      })
    } catch (err) {
      return new stream.PassThrough().destroy(err)
    }
  }

  dispatch (url, opts, handler) {
    try {
      if (typeof url === 'string') {
        url = new URL(url)
      } else if (!(url instanceof URL)) {
        throw new Error('invailid argument: url')
      }

      if (opts.path) {
        throw new Error('invalid argument: opts.path')
      }

      return getClient(this, url.origin).dispatch({
        ...opts,
        path: `${url.pathname || ''}${url.search || ''}`
      }, handler)
    } catch (err) {
      handler.onError(err)
    }
  }

  close (cb) {
    const origins = Array.from(this._origins)
    const promise = Promise.all(origins.map(c => c.close()))
    if (cb) {
      promise.then(() => cb(null, null), (err) => cb(err, null))
    } else {
      return promise
    }
  }

  destroy (err, cb) {
    if (typeof err === 'function') {
      cb = err
      err = null
    }

    const origins = Array.from(this._origins)
    const promise = Promise.all(origins.map(c => c.destroy(err)))
    if (cb) {
      promise.then(() => cb(null, null))
    } else {
      return promise
    }
  }
}

function getClient (agent, origin) {
  let client = agent._origins.get(origin)?.deref()
  if (!client) {
    client = new undici.Pool(origin, agent._options)
    agent._origins.set(origin, client)
  }
  return client
}
