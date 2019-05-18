const querystring = require('querystring')
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

module.exports = { provide }
