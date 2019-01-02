const balanced = require('balanced-match')
const moment = require('moment')

module.exports = async function resolveTemplate (template, context, { ds }) {
  let response = ''
  const match = balanced('{{', '}}', template)
  if (!match) {
    return template
  }
  var { pre, body, post } = match
  response += pre
  response += await parseExpression(body, context, { ds })
  if (post) {
    response += await resolveTemplate(post, context, { ds })
  }
  return response
}

async function parseExpression (expression, context, { ds }) {
  const parts = expression.split('|')
  const baseValuePath = parts.shift().trim()
  const baseValue = getProperty(context, baseValuePath)

  return parts.reduce(await applyFilter(ds), Promise.resolve(baseValue))
}

function getProperty (obj, desc) {
  var arr = desc.split('.')
  while (arr.length && (obj = obj[arr.shift()]));
  return obj
}

function applyFilter (ds) {
  return async (valuePromise, rawFilter) => {
    const value = await valuePromise
    const filter = rawFilter.trim()
    const regExp = /\('([^)]+)'\)/
    const filterValueArr = regExp.exec(filter)
    const filterValue = filterValueArr && filterValueArr[1]

    if (/^moment\(/.test(filter)) {
      return moment(value).format(filterValue)
    } else if (/^append\(/.test(filter)) {
      return value + filterValue
    } else if (/^pluck\(/.test(filter)) {
      return value[filterValue]
    } else if (/^join\(/.test(filter)) {
      return value.join(filterValue)
    } else if (/^ds/.test(filter)) {
      return ds.record.get(value)
    }
  }
}
