const rx = require('rxjs/operators')
const rxjs = require('rxjs')
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
      return rxjs.throwError(err)
    }
  }

  const compileArrayTemplateLazy = (arr) => {
    if (!fp.isArray(arr)) {
      throw new Error('invalid argument')
    }

    let resolvers
    let indices

    for (let i = 0; i < arr.length; i++) {
      const resolver = compileTemplateLazy(arr[i])
      if (resolver) {
        resolvers ??= []
        resolvers.push(resolver)
        indices ??= []
        indices.push(i)
      }
    }

    if (!resolvers) {
      return null
    }

    return (...args) =>
      rxjs.combineLatest(resolvers.map((resolver) => resolver(...args))).pipe(
        rx.map((values) => {
          const ret = [...arr]
          for (let n = 0; n < values.length; n++) {
            ret[indices[n]] = values[n]
          }
          return ret
        })
      )
  }

  const compileArrayTemplate = weakCache(function compileArrayTemplate(arr) {
    return compileArrayTemplateLazy(arr) ?? (() => rxjs.of(arr))
  })

  const compileObjectTemplateLazy = (obj) => {
    if (!fp.isPlainObject(obj)) {
      throw new Error('invalid argument')
    }

    let resolvers
    let indices

    const keys = Object.keys(obj)

    for (let i = 0; i < keys.length; i++) {
      const resolver = compileTemplateLazy(obj[keys[i]])
      if (resolver) {
        resolvers ??= []
        resolvers.push(resolver)
        indices ??= []
        indices.push(keys[i])
      }
    }

    if (!resolvers) {
      return null
    }

    return (...args) =>
      rxjs.combineLatest(resolvers.map((resolver) => resolver(...args))).pipe(
        rx.map((values) => {
          const ret = { ...obj }
          for (let n = 0; n < values.length; n++) {
            ret[indices[n]] = values[n]
          }
          return ret
        })
      )
  }

  const compileObjectTemplate = weakCache(function compileObjectTemplate(obj) {
    return compileObjectTemplateLazy(obj) ?? (() => rxjs.of(obj))
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
      type = str.slice(bodyStart + 1).match(/^([a-z]*)/)[1]
      bodyStart += type.length + 1
    }

    return {
      pre: str.slice(0, templateStart),
      type,
      body: str.slice(bodyStart, bodyEnd),
      post: str.slice(templateEnd),
    }
  }

  const compileStringTemplateLazy = weakCache(function compileStringTemplatLazy(str) {
    if (!fp.isString(str)) {
      throw new Error('invalid argument')
    }

    const match = inner(str)

    if (!match) {
      return null
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

  const compileStringTemplate = function compileStringTemplate(str) {
    return compileStringTemplateLazy(str) ?? (() => rxjs.of(str))
  }

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

  function compileTemplateLazy(template) {
    if (fp.isPlainObject(template)) {
      return compileObjectTemplateLazy(template)
    } else if (fp.isArray(template)) {
      return compileArrayTemplateLazy(template)
    } else if (fp.isString(template)) {
      return compileStringTemplateLazy(template)
    } else {
      return null
    }
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
    return onResolveTemplate(template, ...args)
      .pipe(rx.first())
      .toPromise()
  }

  function onResolveTemplate(str, ...args) {
    if (fp.isString(str) && str.lastIndexOf('{{') === -1) {
      return rxjs.of(str)
    }

    try {
      return compileTemplate(str)(...args)
    } catch (err) {
      return rxjs.throwError(err)
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
