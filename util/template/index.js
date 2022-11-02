const rxjs = require('rxjs')
const fp = require('lodash/fp')
const getNxtpressionsCompiler = require('./nextpressions')
const getJavascriptCompiler = require('./javascript')
const weakCache = require('../../weakCache')
const JSON5 = require('json5')

module.exports = ({ ds } = {}) => {
  const compilers = {
    nxt: getNxtpressionsCompiler({ ds }),
    js: getJavascriptCompiler({ ds }),
  }

  async function resolveObjectTemplate(...args) {
    return rxjs.firstValueFrom(resolveObjectTemplate(...args))
  }

  function onResolveObjectTemplate(obj, ...args) {
    try {
      return compileObjectTemplate(obj)(...args)
    } catch (err) {
      return rxjs.throwError(() => err)
    }
  }

  // TODO (perf): Optimize...
  function compileArrayTemplate(arr) {
    if (!fp.isArray(arr)) {
      throw new Error('invalid argument')
    }

    if (arr.length === 0) {
      return () => rxjs.of([])
    }

    const resolvers = arr.map((template) => compileTemplate(template))

    return (...args) => rxjs.combineLatest(resolvers.map((resolver) => resolver(...args)))
  }

  // TODO (perf): Optimize...
  function compileObjectTemplate(obj) {
    if (!fp.isPlainObject(obj)) {
      throw new Error('invalid argument')
    }

    const keys = Object.keys(obj)

    if (keys.length === 0) {
      return () => rxjs.of({})
    }

    const resolvers = Object.values(obj).map((template) => compileTemplate(template))

    return (...args) =>
      rxjs.combineLatest(resolvers.map((resolver) => resolver(...args))).pipe(
        rxjs.map((values) => {
          const ret = {}
          for (let n = 0; n < values.length; ++n) {
            ret[keys[n]] = values[n]
          }
          return ret
        })
      )
  }

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

  const compileStringTemplate = weakCache((str) => {
    if (!fp.isString(str)) {
      throw new Error('invalid argument')
    }

    const match = inner(str)

    if (!match) {
      return () => rxjs.of(str)
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
        rxjs.switchMap((body) => compileStringTemplate(`${pre}${stringify(body)}${post}`)(...args))
      )
  })

  function stringify(value) {
    if (value == null) {
      return ''
    } else if (fp.isArray(value) || fp.isPlainObject(value)) {
      return JSON5.stringify(value)
    } else if (fp.isString(value)) {
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
      return () => rxjs.of(template)
    }
  }

  async function resolveTemplate(template, ...args) {
    return rxjs.firstValueFrom(onResolveTemplate(template, ...args))
  }

  function onResolveTemplate(str, ...args) {
    if (fp.isString(str) && str.lastIndexOf('{{') === -1) {
      return rxjs.of(str)
    }

    try {
      return compileTemplate(str)(...args)
    } catch (err) {
      return rxjs.throwError(() => err)
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
