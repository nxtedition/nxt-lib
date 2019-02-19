const balanced = require('balanced-match')
const rx = require('rxjs/operators')
const Observable = require('rxjs')
const isPlainObject = require('lodash/isPlainObject')
const getCompiler = require('./expression')

module.exports.onResolveTemplate = onResolveTemplate

module.exports.resolveTemplate = async function (template, context, options = {}) {
  return onResolveTemplate(template, context, options)
    .pipe(
      rx.first()
    )
    .toPromise()
}

function onResolveTemplate (template, context, options = {}) {
  try {
    const match = balanced('{{', '}}', template)
    if (!match) {
      return Observable.of(template)
    }

    const compile = getCompiler(options ? options.ds : null)

    const { pre, body, post } = match

    return onResolveTemplate(body, context, options)
      .pipe(
        rx.switchMap(expr => compile(expr)(context)),
        rx.switchMap(value => {
          if (!pre && !post) {
            return Observable.of(value)
          }

          if (value == null) {
            value = ''
          } else if (Array.isArray(value) || isPlainObject(value)) {
            value = JSON.stringify(value)
          }

          return onResolveTemplate(`${pre}${value}${post}`, context, options)
        })
      )
  } catch (err) {
    return Observable.throwError(err)
  }
}
