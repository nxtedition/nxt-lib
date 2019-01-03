const balanced = require('balanced-match')
const moment = require('moment')
const get = require('lodash/get')
const rx = require('rxjs/operators')
const Observable = require('rxjs')

module.exports.onResolveTemplate = onResolveTemplate

module.exports.resolveTemplate = async function (template, context, options) {
  return onResolveTemplate(template, context, options)
    .pipe(
      rx.first()
    )
    .toPromise()
}

// TODO (perf): Optimize.
// TODO (fix): Error handling.
function onResolveTemplate (template, context, options) {
  const match = balanced('{{', '}}', template)
  if (!match) {
    return Observable.of(template)
  }

  const { pre, body, post } = match

  return onResolveTemplate(body, context, options)
    .pipe(
      rx.switchMap(expr => onParseExpression(expr, context, options)),
      rx.map(value => `${pre}${value || ''}${post}`),
      rx.switchMap(template => onResolveTemplate(template, context, options))
    )
}

function onParseExpression (expression, context, options) {
  const ds = options ? options.ds : null

  const FILTERS = {
    moment: (format) => value => Observable.of(moment(value).format(format)),
    append: (post) => value => Observable.of(String(value) + post),
    prepend: (pre) => value => Observable.of(pre + String(value)),
    pluck: (path) => value => Observable.of(get(value, path)),
    join: (delimiter) => value => Observable.of(Array.isArray(value) ? value.join(delimiter) : null),
    first: () => value => Observable.of(Array.isArray(value) ? value[0] : null),
    int: () => value => parseInt(value),
    ds: () => value => ds ? ds.record.observe(value) : Observable.of(null)
  }

  const [ basePath, ...filters ] = expression.split(/\s*\|\s*/)
  const baseValue = get(context, basePath)

  // TODO (fix): Better parsing...
  return filters
    .map(filter => filter.match(/([^(]+)\((.*)\)/) || [])
    .reduce((value$, [ , name, args ]) => value$
      .pipe(
        rx.switchMap(value => {
          const filter = FILTERS[name]
          return filter ? filter(...args
            .split(/\s*,\s*/)
            .map(x => x.slice(1, -1))
          )(value) : Observable.of(value)
        })
      ), Observable.of(baseValue))
}
