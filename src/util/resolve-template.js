const fp = require('lodash/fp')
const balanced = require('balanced-match')

module.exports = async function resolveTemplate (str, resolver) {
  if (fp.isPlainObject(resolver)) {
    const { map, ds } = resolver

    resolver = async key => {
      if (!fp.isString(key)) {
        return ''
      }

      // {id}:{domain},{path}
      const [ , id, path ] = key.match(/^\s*([^:\s]+:[^,\s]+)(?:\s*,\s*([^\s]+))?\s*$/) || []

      let val
      if (id) {
        val = ds ? await ds.record.get(id, path) : null
      } else {
        val = map ? fp.get(key, map) : null
      }

      return val != null ? String(val) : ''
    }
  }

  let res = ''
  while (true) {
    const match = balanced('${', '}', str)

    if (!match) {
      return res + str
    }

    const { pre, body, post } = match

    res += pre
    res += await resolver(await resolveTemplate(body, resolver))
    str = post
  }
}
