const rx = require('rxjs/operators')
const rxjs = require('rxjs')
const fp = require('lodash/fp')
const getNxtpressionsCompiler = require('./nextpressions')
const getJavascriptCompiler = require('./javascript')
const JSON5 = require('json5')

module.exports = (options) => {
  const compilers = {
    nxt: getNxtpressionsCompiler(options),
    js: getJavascriptCompiler(options),
  }

  const compileArrayTemplate = (arr, args$) => {
    if (!fp.isArray(arr)) {
      throw new Error('invalid argument')
    }

    let resolvers
    let indices

    for (let i = 0; i < arr.length; i++) {
      const resolver = compileTemplate(arr[i], args$)
      if (resolver) {
        resolvers ??= []
        resolvers.push(resolver)
        indices ??= []
        indices.push(i)
      }
    }

    return resolvers
      ? rxjs.combineLatest(resolvers).pipe(
          rx.map((values) => {
            const ret = [...arr]
            for (let n = 0; n < values.length; n++) {
              ret[indices[n]] = values[n]
            }
            return ret
          })
        )
      : null
  }

  const compileObjectTemplate = (obj, args$) => {
    if (!fp.isPlainObject(obj)) {
      throw new Error('invalid argument')
    }

    let resolvers
    let indices

    const keys = Object.keys(obj)

    for (let i = 0; i < keys.length; i++) {
      const resolver = compileTemplate(obj[keys[i]], args$)
      if (resolver) {
        resolvers ??= []
        resolvers.push(resolver)
        indices ??= []
        indices.push(keys[i])
      }
    }

    return resolvers
      ? rxjs.combineLatest(resolvers).pipe(
          rx.map((values) => {
            const ret = { ...obj }
            for (let n = 0; n < values.length; n++) {
              ret[indices[n]] = values[n]
            }
            return ret
          })
        )
      : null
  }

  const inner = function inner(str) {
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
      input: str,
      pre: str.slice(0, templateStart),
      type,
      body: str.slice(bodyStart, bodyEnd),
      post: str.slice(templateEnd),
    }
  }

  function compileStringTemplate(str, args$) {
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
      throw new Error('unknown expression type: ' + type)
    }

    const expr = compileExpression(body)

    if (!pre && !post) {
      return expr(args$)
    }

    return expr(args$).pipe(
      rx.switchMap((body) =>
        compileStringTemplate(`${pre}${stringify(body, type !== 'js')}${post}`, args$)
      )
    )
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

  function compileTemplate(template, args$) {
    if (fp.isPlainObject(template)) {
      return compileObjectTemplate(template, args$)
    } else if (fp.isArray(template)) {
      return compileArrayTemplate(template, args$)
    } else if (fp.isString(template)) {
      return compileStringTemplate(template, args$)
    } else {
      return null
    }
  }

  async function resolveTemplate(template, args$) {
    return rxjs.firstValueFrom(onResolveTemplate(template, args$))
  }

  function onResolveTemplate(template, args$) {
    if (fp.isString(template) && template.lastIndexOf('{{') === -1) {
      return rxjs.of(template)
    }

    try {
      return compileTemplate(template, args$) ?? rxjs.of(template)
    } catch (err) {
      return rxjs.throwError(() => err)
    }
  }

  return {
    resolveTemplate,
    onResolveTemplate,
    compileTemplate,
    isTemplate,
  }
}
