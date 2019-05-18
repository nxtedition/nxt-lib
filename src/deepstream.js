const querystring = require('querystring')
const cached = require('./util/cached')

function provide (ds, domain, callback, options) {
  if (!options || typeof options !== 'object') {
    options = {
      recursive: options === true
    }
  }

  if (options.minAge) {
    callback = cached(callback, { minAge: options.minAge })
  }

  const expr = new RegExp(`([a-zA-Z0-9-_~+/]+):${domain}(?:\\?(.+))?`)
  return ds.record.provide(expr.source, key => {
    const [ , id, queryString ] = key.match(expr)
    return callback(id, queryString ? querystring.parse(queryString) : {}, key)
  }, options.recursive)
}

module.exports = { provide }
