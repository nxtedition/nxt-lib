const rx = require('rxjs/operators')
const Observable = require('rxjs')
const fp = require('lodash/fp')
const getExpressionCompiler = require('./expression')
const memoize = require('memoizee')
const JSON5 = require('json5')

module.exports = ({ ds } = {}) => {
  const compileExpression = getExpressionCompiler({ ds })

  async function resolveObjectTemplate (obj, context) {
    return resolveObjectTemplate(obj, context)
      .pipe(
        rx.first()
      )
      .toPromise()
  }

  function onResolveObjectTemplate (obj, context) {
    try {
      return compileObjectTemplate(obj)(context)
    } catch (err) {
      return Observable.throwError(err)
    }
  }

  // TODO (perf): Optimize...
  function compileArrayTemplate (arr) {
    if (!fp.isArray(arr)) {
      throw new Error('invalid argument')
    }

    if (arr.length === 0) {
      return () => Observable.of([])
    }

    const resolvers = arr.map(template => compileTemplate(template))

    return context => Observable.combineLatest(resolvers.map(resolver => resolver(context)))
  }

  // TODO (perf): Optimize...
  function compileObjectTemplate (obj) {
    if (!fp.isPlainObject(obj)) {
      throw new Error('invalid argument')
    }

    const keys = Object.keys(obj)

    if (keys.length === 0) {
      return () => Observable.of({})
    }

    const resolvers = Object.values(obj).map(template => compileTemplate(template))

    return context => Observable
      .combineLatest(resolvers.map(resolver => resolver(context)))
      .pipe(
        rx.map(values => {
          const ret = {}
          for (let n = 0; n < values.length; ++n) {
            ret[keys[n]] = values[n]
          }
          return ret
        })
      )
  }

  function inner (str) {
    const start = str.lastIndexOf('{{')
    if (start === -1) {
      return null
    }
    const end = str.indexOf('}}', start + 2)
    if (end === -1) {
      return null
    }

    return {
      pre: str.slice(0, start),
      body: str.slice(start + 2, end),
      post: str.slice(end + 2)
    }
  }

  const compileStringTemplate = memoize(str => {
    if (!fp.isString(str)) {
      throw new Error('invalid argument')
    }

    const match = inner(str)

    if (!match) {
      return () => Observable.of(str)
    }

    const { pre, body, post } = match

    const expr = compileExpression(body)

    if (!pre && !post) {
      return expr
    }

    return context => expr(context)
      .pipe(
        rx.switchMap(body => compileTemplate(`${pre}${stringify(body)}${post}`)(context))
      )
  }, {
    max: 1024,
    primitive: true
  })

  function stringify (value) {
    if (value == null) {
      return ''
    } else if (fp.isArray(value) || fp.isPlainObject(value)) {
      return JSON5.stringify(value)
    } else if (fp.isString(value)) {
      return value.replace(/"/g, '\\"')
    }
    return value
  }

  function isTemplate (val) {
    return typeof val === 'string' && val.indexOf('{{') !== -1
  }

  function compileTemplate (template) {
    if (fp.isPlainObject(template)) {
      return compileObjectTemplate(template)
    } else if (fp.isArray(template)) {
      return compileArrayTemplate(template)
    } else if (fp.isString(template)) {
      return compileStringTemplate(template)
    } else {
      return () => Observable.of(template)
    }
  }

  async function resolveTemplate (template, context) {
    return onResolveTemplate(template, context)
      .pipe(
        rx.first()
      )
      .toPromise()
  }

  function onResolveTemplate (str, context) {
    if (fp.isString(str) && str.lastIndexOf('{{') === -1) {
      return Observable.of(str)
    }

    try {
      return compileTemplate(str)(context)
    } catch (err) {
      return Observable.throwError(err)
    }
  }

  return {
    resolveTemplate,
    onResolveTemplate,
    compileTemplate,

    // Deprecated
    resolveObjectTemplate,
    onResolveObjectTemplate,
    compileObjectTemplate,
    isTemplate
  }
}
