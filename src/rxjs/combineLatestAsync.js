const { Observable } = require('rxjs')

const NONE = {}

function combineLatestAsync (observables, project) {
  return Observable.create(o => {
    if (observables.length === 0) {
      o.complete()
      return
    }

    let immediate = null
    let ready = observables.length
    let completed = observables.length

    const values = []
    const subscriptions = []

    function _next () {
      immediate = null
      o.next(project ? project(...values) : [ ...values ])
    }

    function _schedule () {
      if (!immediate && ready > 0) {
        immediate = setImmediate(_next)
      }
    }

    for (let n = 0; n < observables.length; ++n) {
      values.push(NONE)
      subscriptions.push(this.subscribe({
        next: value => {
          if (ready > 0 && values[n] === NONE) {
            ready -= 1
          }

          values[n] = value

          _schedule()
        },
        error: err => o.error(err),
        complete: () => {
          completed -= 1
          if (completed > 0) {
            return
          }

          if (immediate) {
            clearImmediate(immediate)
            _next()
          }

          o.complete()
        }
      }))
    }

    return () => {
      clearImmediate(immediate)
      immediate = null

      for (const subscription of subscriptions) {
        subscription.unsubscribe()
      }
    }
  })
}

module.exports = combineLatestAsync

Observable.prototype.combineLatestAsync = function (...args) {
  return combineLatestAsync(this, ...args)
}
