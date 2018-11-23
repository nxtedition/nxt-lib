const fp = require('lodash/fp')
const balanced = require('balanced-match')

module.exports = function applyMatches (str, matches) {
  try {
    return fp.isString(str) && fp.isPlainObject(matches) ? applyMatchesImpl(str, matches) : str
  } catch (err) {

  }
}

function applyMatchesImpl (str, matches) {
  let res

  if (/^`.+`$/.test(str)) {
    // String mode
    res = ''
    str = str.slice(1, -1)
  }

  while (true) {
    const match = balanced('{{', '}}', str)

    if (!match) {
      if (!str) {
        return res
      } else if (fp.isString(res)) {
        return String(res) + String(str)
      } else if (res === undefined) {
        return str
      } else {
        throw new Error()
      }
    }

    const { pre, body, post } = match
    str = post

    if (!res && str) {
      res = ''
    }

    if (pre) {
      if (fp.isString(res)) {
        res = String(res) + pre
      } else if (res === undefined) {
        res = pre
      } else {
        throw new Error()
      }
    }

    let key = applyMatchesImpl(body, matches)

    if (fp.isInteger(key)) {
      key = String(key)
    }

    if (!fp.isString(key)) {
      throw new Error()
    }

    const val = fp.get(key, matches)

    if (val === undefined) {
      continue
    }

    if (fp.isString(res)) {
      if (!fp.isString(val) && !fp.isInteger(val)) {
        throw new Error()
      }
      res = String(res) + String(val)
    } else if (res === undefined) {
      res = val
    } else {
      throw new Error()
    }
  }
}
