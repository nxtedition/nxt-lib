import * as rxjs from 'rxjs'
import fp from 'lodash/fp.js'
import getNxtpressionsCompiler from './nextpressions.js'
import getJavascriptCompiler from './javascript.js'
import JSON5 from 'json5'
import objectHash from 'object-hash'
import { makeWeakCache } from '../../weakCache.js'
import firstValueFrom from '../../rxjs/firstValueFrom.js'

export function makeTemplateCompiler({ ds, proxify }) {
  const compiler = {
    current: null,
    resolveTemplate,
    onResolveTemplate,
    compileTemplate,
    isTemplate,
  }

  const compilers = {
    nxt: getNxtpressionsCompiler({ ds }),
    js: getJavascriptCompiler({ ds, proxify, compiler }),
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

  function compileArrayTemplate(template) {
    let resolvers
    let indices

    for (let i = 0; i < template.length; i++) {
      const resolver = _compileTemplate(template[i])
      if (resolver) {
        resolvers ??= []
        resolvers.push(resolver)
        indices ??= []
        indices.push(i)
      }
    }

    return resolvers
      ? (arr, args$) => {
          const len = resolvers.length
          const values = new Array(len)
          for (let n = 0; n < len; n++) {
            values[n] = resolvers[n](arr[indices[n]], args$)
          }

          return rxjs.combineLatest(values).pipe(
            rxjs.map((values) => {
              const ret = [...arr]
              for (let n = 0; n < values.length; n++) {
                ret[indices[n]] = values[n]
              }
              return ret
            }),
          )
        }
      : null
  }

  function compileObjectTemplate(template) {
    let resolvers
    let indices

    const keys = Object.keys(template)

    for (let i = 0; i < keys.length; i++) {
      const resolver = _compileTemplate(template[keys[i]])
      if (resolver) {
        resolvers ??= []
        resolvers.push(resolver)
        indices ??= []
        indices.push(keys[i])
      }
    }

    return resolvers
      ? (obj, args$) => {
          const len = resolvers.length
          const values = new Array(len)
          for (let n = 0; n < len; n++) {
            values[n] = resolvers[n](obj[indices[n]], args$)
          }

          return rxjs.combineLatest(values).pipe(
            rxjs.map((values) => {
              const ret = { ...obj }
              for (let n = 0; n < values.length; n++) {
                ret[indices[n]] = values[n]
              }
              return ret
            }),
          )
        }
      : null
  }

  function compileStringTemplate(template) {
    const match = inner(template)
    if (!match) {
      return null
    }

    const { pre, type, body, post } = match

    if (type === 'js') {
      const expr = compilers.js(body)

      if (!pre && !post) {
        return (str, args$) => expr(args$)
      }

      return (str, args$) =>
        rxjs
          .combineLatest([
            compileStringTemplate(pre)?.(str, args$) ?? rxjs.of(pre),
            expr(args$),
            compileStringTemplate(post)?.(str, args$) ?? rxjs.of(post),
          ])
          .pipe(
            rxjs.map(([pre, body, post]) =>
              pre || post ? `${pre}${stringify(body)}${post}` : body,
            ),
          )
    } else if (type === 'nxt') {
      const expr = compilers.nxt(body)

      if (!pre && !post) {
        return (str, args$) => expr(args$)
      }

      return (str, args$) =>
        expr(args$).pipe(
          rxjs.switchMap((body) =>
            onResolveTemplate(`${pre}${stringify(body, true)}${post}`, args$),
          ),
        )
    } else {
      throw new Error('unknown expression type: ' + type)
    }
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

  const _compileTemplateCache = makeWeakCache(
    (template) => {
      if (fp.isPlainObject(template)) {
        return compileObjectTemplate(template)
      } else if (fp.isArray(template)) {
        return compileArrayTemplate(template)
      } else if (isTemplate(template)) {
        return compileStringTemplate(template)
      } else {
        return null
      }
    },
    (template, hash) => hash,
  )

  function _compileTemplate(template) {
    const hash = hashTemplate(template)
    const resolver = hash ? _compileTemplateCache(template, hash) : null
    return resolver // ? (args$) => resolver(template, args$) : null
  }

  function compileTemplate(template) {
    const resolver = _compileTemplate(template)
    return resolver ? (args$) => resolver(template, args$) : null
  }

  async function resolveTemplate(template, args$, options) {
    return firstValueFrom(onResolveTemplate(template, args$), options)
  }

  function onResolveTemplate(template, args$) {
    try {
      return _compileTemplate(template)?.(template, args$) ?? rxjs.of(template)
    } catch (err) {
      return rxjs.throwError(() => err)
    }
  }

  return compiler
}
