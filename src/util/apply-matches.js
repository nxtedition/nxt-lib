const fp = require('lodash/fp')
const balanced = require('balanced-match')

module.exports = function applyMatches (str, matches) {
  return fp.isString(str) && fp.isPlainObject(matches) ? applyMatchesImpl(str, matches) : str
}

function applyMatchesImpl (str, matches) {
  let res = ''
  while (true) {
    const match = balanced('{{', '}}', str)

    if (!match) {
      return res + str
    }

    const { pre, body, post } = match

    res += pre
    res += fp.getOr('', applyMatchesImpl(body, matches), matches)
    str = post
  }
}
