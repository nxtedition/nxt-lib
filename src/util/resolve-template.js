const balanced = require('balanced-match')
const moment = require('moment')
const get = require('lodash/get')

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
  const [ basePath, ...parts ] = expression.split(/\s*\|\s*/)
  const baseValue = get(context, basePath)

  return parts.reduce(async (valuePromise, filter) => {
    const value = await valuePromise
    const regExp = /\('([^)]+)'\)/
    const filterValueArr = regExp.exec(filter)
    const filterValue = filterValueArr && filterValueArr[1]

    if (/^moment\(/.test(filter)) {
      return moment(value).format(filterValue)
    } else if (/^append\(/.test(filter)) {
      return value + filterValue
    } else if (/^(pluck|get)\(/.test(filter)) {
      return value[filterValue]
    } else if (/^join\(/.test(filter)) {
      return value.join(filterValue)
    } else if (/^ds/.test(filter)) {
      return ds.record.get(value)
    }
  }, baseValue)
}
