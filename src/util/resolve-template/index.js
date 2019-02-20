const rx = require('rxjs/operators')
const Observable = require('rxjs')
const isPlainObject = require('lodash/isPlainObject')
const isString = require('lodash/isString')
const getExpressionCompiler = require('./expression')
const memoize = require('memoizee')

module.exports.onResolveTemplate = onResolveTemplate

module.exports.resolveTemplate = async function (template, context, options = {}) {
  return onResolveTemplate(template, context, options)
    .pipe(
      rx.first()
    )
    .toPromise()
}

function inner (str) {
  const start = str.lastIndexOf('{{')
  if (start === -1) {
    return null
  }
  const end = str.indexOf('}}', start)
  if (end === -1) {
    return null
  }

  return {
    pre: str.slice(0, start),
    body: str.slice(start + 2, end),
    post: str.slice(end + 2)
  }
}

const getTemplateCompiler = memoize(function (ds) {
  const compileExpression = getExpressionCompiler(ds)

  return memoize(function compileTemplate (str) {
    if (!str || !isString(str)) {
      return () => Observable.of(str)
    }

    const match = inner(str)

    if (!match) {
      return () => Observable.of(str)
    }

    const { pre, body, post } = match

    const expr = compileExpression(body)

    return context => expr(context)
      .pipe(
        rx.switchMap(body => compileTemplate(pre || post ? `${pre}${stringify(body)}${post}` : body)(context))
      )
  }, {
    max: 1024,
    primitive: true
  })
}, { max: 2 })

function onResolveTemplate (str, context, options = {}) {
  if (!str || !isString(str) || str.lastIndexOf('{{') === -1) {
    return () => Observable.of(str)
  }

  try {
    const compileTemplate = getTemplateCompiler(options ? options.ds : null)
    return compileTemplate(str)(context)
  } catch (err) {
    return Observable.throwError(err)
  }
}

function stringify (value) {
  if (value == null) {
    return ''
  } else if (Array.isArray(value) || isPlainObject(value)) {
    return JSON.stringify(value)
  }
  return value
}
