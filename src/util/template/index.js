const rx = require('rxjs/operators')
const Observable = require('rxjs')
const fp = require('lodash/fp')
const getExpressionCompiler = require('./expression')
const memoize = require('memoizee')
const moment = require('moment')
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
  function compileObjectTemplate (obj) {
    if (!fp.isPlainObject(obj)) {
      throw new Error('invalid argument')
    }

    const resolvers = []
    // TODO (fix): Make iterative
    function compile (path, obj) {
      for (const [key, val] of Object.entries(obj)) {
        if (fp.isObjectLike(val)) {
          compile(path.concat(key), val)
        } else if (isTemplate(val)) {
          resolvers.push([path.concat(key), compileTemplate(val)])
        }
      }
    }
    compile([], obj)

    return context => resolvers.length === 0
      ? Observable
        .of(obj)
      : Observable
        .combineLatest(resolvers.map(([path, resolver]) => resolver(context).map(val => [path, val])))
        .map(fp.reduce((acc, [path, val]) => fp.set(path, val, acc), obj))
  }

  async function resolveTemplate (template, context) {
    return onResolveTemplate(template, context)
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

  const compileTemplate = memoize(str => {
    if (!fp.isString(str)) {
      throw new Error('invalid argument')
    }

    const match = inner(str)

    if (!match) {
      return context => Observable.of(str)
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

  return {
    resolveObjectTemplate,
    onResolveObjectTemplate,
    compileObjectTemplate,

    resolveTemplate,
    onResolveTemplate,
    compileTemplate,

    isTemplate
  }
}
