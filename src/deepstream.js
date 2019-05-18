const querystring = require('querystring')
const objectHash = require('object-hash')
const cached = require('./util/cached')

function provide (ds, domain, callback, options) {
  if (!options || typeof options !== 'object') {
    options = {
      recursive: options === true
    }
  }

  if (options.minAge) {
    callback = cached(callback, options, (id, options, key) => key)
  }

  return ds.record.provide(`^(.*:)?${domain.replace('.', '\\.')}(\\?.*)?$`, key => {
    const [ id, options ] = parseKey(key)
    return callback(id, options, key)
  }, options.recursive)
}

function parseKey (key) {
  const { json, id, query } = key.match(/^(?:(?<json>\{.+\})|(?<id>.*):)?[^?]*(?:\?(?<query>.*))?$/).groups
  if (query) {
    return [ id || '', querystring.parse(query) ]
  } else if (json) {
    return [ '', JSON.parse(json) ]
  } else {
    return [ id || '', {} ]
  }
}

function query (ds, { view, filter, startkey, endkey, limit }) {
  if (view || filter) {
    view = stringifyFn(view)
    filter = stringifyFn(filter)

    const id = objectHash({ view, filter })
    ds.record.set(`${id}:_query`, { view, filter })
    return ds.record.observe(`${id}:query?${querystring.stringify({ startkey, endkey, limit })}`, ds.record.PROVIDER)
  } else {
    return ds.record.observe(`query?${querystring.stringify({ startkey, endkey, limit })}`, ds.record.PROVIDER)
  }
}

function stringifyFn (fn) {
  return typeof fn === 'function' ? fn.toString().match(/\{([\s\S]+)\}/m)[1] : fn
}

module.exports = { provide, query }
