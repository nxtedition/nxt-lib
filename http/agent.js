const undici = require('undici')
const stream = require('stream')

/* global FinalizationRegistry, WeakRef */

module.exports = class HttpAgent {
  constructor (factory = (url) => new undici.Pool(url)) {
    this._factory = factory
    this._origins = new Map()
    this._registry = new FinalizationRegistry(origin => {
      this._origins.delete(origin)
    })
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
}

function getClient (agent, origin) {
  let client = agent._origins.get(origin)?.deref()
  if (!client) {
    client = new undici.Pool(origin, agent._options)
    agent._origins.set(origin, new WeakRef(client))
    agent._registry.register(client, origin)
  }
  return client
}
