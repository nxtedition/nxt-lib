const rx = require('rxjs/operators')
const Observable = require('rxjs')
const fp = require('lodash/fp')
const getNxtpressionsCompiler = require('./nextpressions')
const getJavascriptCompiler = require('./javascript')
const weakCache = require('../../weakCache')
const JSON5 = require('json5')

module.exports = (options) => {
  const compilers = {
    nxt: getNxtpressionsCompiler(options),
    js: getJavascriptCompiler(options),
  }

  async function resolveObjectTemplate(...args) {
    return resolveObjectTemplate(...args)
      .pipe(rx.first())
      .toPromise()
  }

  function onResolveObjectTemplate(obj, ...args) {
    try {
      return compileObjectTemplate(obj)(...args)
    } catch (err) {
      return Observable.throwError(err)
    }
  }

  // TODO (perf): Optimize...
  const compileArrayTemplate = weakCache(function compileArrayTemplate(arr) {
    if (!fp.isArray(arr)) {
      throw new Error('invalid argument')
    }

    if (arr.length === 0) {
      return () => Observable.of([])
    }

    const resolvers = arr.map((template) => compileTemplate(template))

    return (...args) => Observable.combineLatest(resolvers.map((resolver) => resolver(...args)))
  })

  // TODO (perf): Optimize...
  const compileObjectTemplate = weakCache(function compileObjectTemplate(obj) {
    if (!fp.isPlainObject(obj)) {
      throw new Error('invalid argument')
    }

    const xs = []
    for (const key of Object.keys(obj)) {
      xs.push(key, obj[key])
    }

    if (xs.length === 0) {
      return () => Observable.of({})
    }

    const resolvers = xs.map((template) => compileTemplate(template))

    return (...args) =>
      Observable.combineLatest(resolvers.map((resolver) => resolver(...args))).pipe(
        rx.map((ys) => {
          const ret = {}
          for (let n = 0; n < ys.length; n += 2) {
            ret[ys[n + 0]] = ys[n + 1]
          }
          return ret
        })
      )
  })

  function inner(str) {
    const templateStart = str.lastIndexOf('{{')
    if (templateStart === -1) {
      return null
    }
    let bodyStart = templateStart + 2

    let templateEnd = str.indexOf('}}', templateStart + 2)
    if (templateEnd === -1) {
      return null
    }
    const bodyEnd = templateEnd
    templateEnd += 2

    let type = 'nxt'
    if (str[bodyStart] === '#') {
      const typeStart = bodyStart + 1
      const typeEnd = str.indexOf(' ', bodyStart + 1)
      type = str.slice(typeStart, typeEnd)
      bodyStart = typeEnd + 1
    }

    return {
      pre: str.slice(0, templateStart),
      type,
      body: str.slice(bodyStart, bodyEnd),
      post: str.slice(templateEnd),
    }
  }

  const compileStringTemplate = weakCache(function compileStringTemplate(str) {
    if (!fp.isString(str)) {
      throw new Error('invalid argument')
    }

    const match = inner(str)

    if (!match) {
      return () => Observable.of(str)
    }

    const { pre, type, body, post } = match

    const compileExpression = compilers[type]
    if (!compileExpression) {
      throw new Error('unknown expression type')
    }

    const expr = compileExpression(body)

    if (!pre && !post) {
      return expr
    }

    return (...args) =>
      expr(...args).pipe(
        rx.switchMap((body) =>
          compileStringTemplate(`${pre}${stringify(body, type !== 'js')}${post}`)(...args)
        )
      )
  })

  function stringify(value, escape) {
    if (value == null) {
      return ''
    } else if (fp.isArray(value) || fp.isPlainObject(value)) {
      return JSON5.stringify(value)
    } else if (fp.isString(value) && escape) {
      return value.replace(/"/g, '\\"')
    }
    return value
  }

  function isTemplate(val) {
    return typeof val === 'string' && val.indexOf('{{') !== -1
  }

  function compileTemplate(template) {
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

  async function resolveTemplate(template, ...args) {
    return onResolveTemplate(template, ...args)
      .pipe(rx.first())
      .toPromise()
  }

  function onResolveTemplate(str, ...args) {
    if (fp.isString(str) && str.lastIndexOf('{{') === -1) {
      return Observable.of(str)
    }

    try {
      return compileTemplate(str)(...args)
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
    isTemplate,
  }
}
