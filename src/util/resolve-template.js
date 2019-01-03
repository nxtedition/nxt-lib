const balanced = require('balanced-match')
const moment = require('moment')
const get = require('lodash/get')

module.exports = async function resolveTemplate (template, context, { ds } = {}) {
  let response = template
  let match = false
  while (true) {
    match = balanced('{{', '}}', response)
    if (!match) {
      return response
    }

    const { pre, body, post } = match

    const expr = await resolveTemplate(body, context, { ds })
    const value = await parseExpression(expr, context, { ds })

    response = `${pre}${value}${post}`
  }
}

async function parseExpression (expression, context, { ds }) {
  const [ basePath, ...parts ] = expression.split(/\s*\|\s*/)
  const baseValue = get(context, basePath)

  // TODO (fix): Parsing errors...

  return parts.reduce(async (valuePromise, filter) => {
    const value = await valuePromise

    const regExp = /\('([^)]+)'\)/
    const filterValueArr = regExp.exec(filter)
    const filterValue = filterValueArr && filterValueArr[1]

    if (/^moment\(/.test(filter)) {
      return moment(parseInt(value)).format(filterValue)
    }

    if (/^append\(/.test(filter)) {
      return String(value) + filterValue
    }

    if (/^(pluck|get)\(/.test(filter)) {
      return value[filterValue]
    }

    if (/^join\(/.test(filter)) {
      return value.join(filterValue)
    }

    if (/^ds\(/.test(filter)) {
      return ds.record.get(value)
    }

    return value
  }, baseValue)
}
