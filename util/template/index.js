const rx = require('rxjs/operators')
const rxjs = require('rxjs')
const fp = require('lodash/fp')
const getNxtpressionsCompiler = require('./nextpressions')
const getJavascriptCompiler = require('./javascript')
const JSON5 = require('json5')
const objectHash = require('object-hash')
const weakCache = require('../../weakCache')

module.exports = (options) => {
  const compilers = {
    nxt: getNxtpressionsCompiler(options),
    js: getJavascriptCompiler(options),
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

  const hashTemplate = (template, prefix) => {
    if (fp.isPlainObject(template)) {
      let hashes
      for (const key of Object.keys(template)) {
        const hash = hashTemplate(template[key], key)
        if (hash) {
          hashes ??= []
          hashes.push(hash)
        }
      }
      return hashes ? objectHash([prefix, hashes]) : ''
    } else if (fp.isArray(template)) {
      let hashes
      for (let idx = 0; idx < template.length; idx++) {
        const hash = hashTemplate(template[idx], idx)
        if (hash) {
          hashes ??= []
          hashes.push(hash)
        }
      }
      return hashes ? objectHash([prefix, hashes]) : ''
    } else if (isTemplate(template)) {
      return objectHash([prefix, template])
    } else {
      return ''
    }
  }

  const _compileArrayTemplate = weakCache(
    (arr, hash) => {
      if (!fp.isArray(arr)) {
        throw new Error('invalid argument')
      }

      if (!hash) {
        return null
      }

      let resolvers
      let indices

      for (let i = 0; i < arr.length; i++) {
        const resolver = compileTemplate(arr[i])
        if (resolver) {
          resolvers ??= []
          resolvers.push(resolver)
          indices ??= []
          indices.push(i)
        }
      }

      return resolvers
        ? (args$) =>
            rxjs.combineLatest(resolvers.map((resolver) => resolver(args$))).pipe(
              rx.map((values) => {
                const ret = [...arr]
                for (let n = 0; n < values.length; n++) {
                  ret[indices[n]] = values[n]
                }
                return ret
              })
            )
        : null
    },
    (arr, hash) => hash ?? hashTemplate(arr)
  )

  const compileArrayTemplate = (arr) => {
    if (!fp.isArray(arr)) {
      throw new Error('invalid argument')
    }
    const hash = hashTemplate(arr)
    return hash ? _compileArrayTemplate(arr, hash) : null
  }

  const _compileObjectTemplate = weakCache(
    (obj, hash) => {
      if (!fp.isPlainObject(obj)) {
        throw new Error('invalid argument')
      }

      if (!hash) {
        return null
      }

      let resolvers
      let indices

      const keys = Object.keys(obj)

      for (let i = 0; i < keys.length; i++) {
        const resolver = compileTemplate(obj[keys[i]])
        if (resolver) {
          resolvers ??= []
          resolvers.push(resolver)
          indices ??= []
          indices.push(keys[i])
        }
      }

      return resolvers
        ? (args$) =>
            rxjs.combineLatest(resolvers.map((resolver) => resolver(args$))).pipe(
              rx.map((values) => {
                const ret = { ...obj }
                for (let n = 0; n < values.length; n++) {
                  ret[indices[n]] = values[n]
                }
                return ret
              })
            )
        : null
    },
    (obj, hash) => hash ?? hashTemplate(obj)
  )

  const compileObjectTemplate = (obj) => {
    if (!fp.isPlainObject(obj)) {
      throw new Error('invalid argument')
    }

    const hash = hashTemplate(obj)
    return hash ? _compileObjectTemplate(obj, hash) : null
  }

  const _compileStringTemplate = weakCache(
    (str, hash) => {
      if (!fp.isString(str)) {
        throw new Error('invalid argument')
      }

      if (!hash) {
        return null
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
        return (args$) => expr(args$)
      }

      return (args$) =>
        expr(args$).pipe(rx.map((body) => `${pre}${stringify(body, type !== 'js')}${post}`))
    },
    (str, hash) => hash ?? hashTemplate(str)
  )

  const compileStringTemplate = (obj) => {
    if (!fp.isString(obj)) {
      throw new Error('invalid argument')
    }

    const hash = hashTemplate(obj)
    return hash ? _compileStringTemplate(obj, hash) : null
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

  function compileTemplate(template) {
    if (fp.isPlainObject(template)) {
      return compileObjectTemplate(template)
    } else if (fp.isArray(template)) {
      return compileArrayTemplate(template)
    } else if (isTemplate(template)) {
      return compileStringTemplate(template)
    } else {
      return null
    }
  }

  async function resolveTemplate(template, args$) {
    return rxjs.firstValueFrom(onResolveTemplate(template, args$))
  }

  function onResolveTemplate(template, args$) {
    try {
      return compileTemplate(template)?.(args$) ?? rxjs.of(template)
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
