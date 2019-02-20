const balanced = require('balanced-match')
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

const getTemplateCompiler = memoize(function (ds) {
  const compileExpression = getExpressionCompiler(ds)

  return memoize(function compileTemplate (str, isRoot = true) {
    if (!str || !isString(str)) {
      return () => Observable.of(str)
    }

    const match = balanced('{{', '}}', str)

    if (!match) {
      if (isRoot) {
        return () => Observable.of(str)
      } else {
        return compileExpression(str)
      }
    }

    const { pre, body, post } = match

    const onBody = compileTemplate(body, false)

    if (!pre && !post) {
      return context => onBody(context)
        .pipe(
          rx.switchMap(body => compileTemplate(body, isRoot)(context))
        )
    }

    const onPost = compileTemplate(post, true)

    return context => {
      return Observable
        .combineLatest(
          onBody(context),
          onPost(context),
          (body, post) => pre || post ? `${pre}${stringify(body)}${stringify(post)}` : body
        )
        .pipe(
          rx.switchMap(template => compileTemplate(template, isRoot)(context))
        )
    }
  }, {
    max: 1024,
    primitive: true
  })
}, { max: 2 })

function onResolveTemplate (str, context, options = {}) {
  try {
    const compileTemplate = getTemplateCompiler(options ? options.ds : null)
    return compileTemplate(str, true)(context)
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
