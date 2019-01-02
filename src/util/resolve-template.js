const balanced = require('balanced-match')
const moment = require('moment')

module.exports = async function resolveTemplate (template, context, { ds }) {
  let response = template
  let match = false
  while (true) {
    match = balanced('{{', '}}', response)
    if (!match) {
      return response
    }
    const { pre, body, post } = match
    const value = await parseExpression(body, context, { ds })
    response = `${pre}${value}${post}`
  }
}

async function parseExpression (expression, context, { ds }) {
  const parts = expression.split('|')
  const baseValuePath = parts.shift().trim()
  const baseValue = getProperty(context, baseValuePath)

  return parts.reduce(await applyFilter(ds), Promise.resolve(baseValue))
}

function getProperty (obj, desc) {
  const arr = desc.split('.')
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
