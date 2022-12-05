const weakCache = require('../../weakCache')
const rxjs = require('rxjs')
const vm = require('node:vm')
const objectHash = require('object-hash')
const datefns = require('date-fns')
const JSON5 = require('json5')
const undici = require('undici')

const kSuspend = Symbol('kSuspend')
const kEmpty = Symbol('kEmpty')
const maxInt = 2147483647

class TimerEntry {
  constructor(key, refresh, delay) {
    this.key = key
    this.counter = null
    this.timer = setTimeout(refresh, delay)
  }

  dispose() {
    clearTimeout(this.timer)
  }
}

class FetchEntry {
  constructor(key, refresh, { url, headers }) {
    this.key = key
    this.counter = null
    this.refresh = refresh
    this.ac = new AbortController()
    this.body = null
    this.status = null
    this.headers = headers
    this.error = null

    // TODO (fix): Cache...
    // TODO (fix): Expire...
    undici
      .fetch(url, { headers, signal: this.ac.signal })
      .then(async (res) => {
        this.buffer = Buffer.from(await res.arrayBuffer())
        this.status = res.status
        this.headers = res.headers
        this.refresh()
      })
      .catch((err) => {
        this.error = err
        this.refresh()
      })
  }

  dispose() {
    this.ac.abort()
  }
}

class RecordEntry {
  constructor(key, refresh, ds) {
    this.key = key
    this.counter = null
    this.refresh = refresh
    this.record = ds.record.getRecord(key)
    this.record.on('update', refresh)
  }

  dispose() {
    this.record.unref()
    this.record.off('update', this.refresh)
    this.record = null
  }
}

class ObservableEntry {
  constructor(key, refresh, observable) {
    this.key = key
    this.counter = null
    this.value = kEmpty
    this.error = null
    this.refresh = refresh
    this.subscription = observable.subscribe({
      next: (value) => {
        this.value = value
        this.refresh()
      },
      error: (err) => {
        this.error = err
        this.refresh()
      },
    })
  }

  dispose() {
    this.subscription.unsubscribe()
    this.subscription = null
  }
}

function pipe(value, ...fns) {
  for (const fn of fns) {
    value = fn(value)
    if (value == null) {
      return value
    }
  }
  return value
}

const globals = {
  fp: require('lodash/fp'),
  moment: require('moment-timezone'),
  datefns,
  JSON5,
  pipe,
  $: null,
  nxt: null,
}

function proxyify(value, expression, handler) {
  if (!value) {
    return value
  } else if (rxjs.isObservable(value)) {
    return proxyify(expression.observe(value), expression, handler)
  } else if (typeof value === 'object') {
    return new Proxy(value, handler)
  } else {
    return value
  }
}

module.exports = ({ ds, ...options }) => {
  class Expression {
    constructor(context, script, expression, args, observer) {
      this._context = context
      this._expression = expression
      this._observer = observer
      this._script = script

      // TODO (perf): This could be faster by using an array + indices.
      // A bit similar to how react-hooks works.
      this._entries = new Map()
      this._refreshing = false
      this._counter = 0
      this._value = kEmpty
      this._disposing = false
      this._destroyed = false
      this._subscription = null

      const handler = {
        get: (target, prop) => proxyify(target[prop], this, handler),
      }

      if (rxjs.isObservable(args)) {
        this._args = {}
        this._subscription = args.subscribe({
          next: (args) => {
            this._args = options.proxyify ? proxyify(args, this, handler) : args
            this._refresh()
          },
          error: (err) => {
            observer.error(err)
          },
        })
      } else {
        this._args = options.proxyify ? proxyify(args, this, handler) : args
      }

      this._refreshNT(this)
    }

    suspend() {
      throw kSuspend
    }

    fetch(url, headers, throws) {
      return this._getFetch(url, headers, throws)
    }

    observe(observable, throws) {
      return this._getObservable(observable, throws)
    }

    ds(key, state, throws) {
      return this._getRecord(key, state, throws)
    }

    asset(id, type, state, throws) {
      return this._getHasRawAssetType(id, type, state, throws)
    }

    timer(dueTime, dueValue) {
      return this._getTimer(dueTime, dueValue)
    }

    hash(value) {
      return objectHash(value)
    }

    _destroy() {
      this._destroyed = true
      this._subscription?.unsubscribe()
      for (const entry of this._entries.values()) {
        entry.dispose()
      }
      this._entries.clear()
    }

    _refreshNT(self) {
      if (self._destroyed) {
        return
      }

      self._refreshing = false
      self._counter = (self._counter + 1) & maxInt

      // TODO (fix): freeze?
      self._context.$ = self._args
      self._context.nxt = self
      try {
        const value = self._script.runInContext(self._context)
        if (value !== self._value) {
          self._value = value
          self._observer.next(value)
        }
      } catch (err) {
        if (err !== kSuspend) {
          self._observer.error(
            Object.assign(err, {
              expression: self._expression,
            })
          )
        }
      } finally {
        self._context.$ = null
        self._context.nxt = null
      }

      for (const entry of self._entries.values()) {
        self._disposing = true
        if (entry.counter !== self._counter) {
          entry.dispose()
          self._entries.delete(entry.key)
        }
        self._disposing = false
      }
    }

    _refresh = () => {
      if (!this._refreshing && !this._destroyed && !this._disposing) {
        this._refreshing = true
        process.nextTick(this._refreshNT, this)
      }
    }

    _getEntry(key, Entry, opaque) {
      let entry = this._entries.get(key)
      if (!entry) {
        entry = new Entry(key, this._refresh, opaque)
        this._entries.set(key, entry)
      }
      entry.counter = this._counter
      return entry
    }

    _getFetch(url, headers, throws) {
      const key = JSON.stringify({ url, headers })
      const entry = this._getEntry(key, FetchEntry, { url, headers })

      if (entry.error) {
        throw entry.error
      }

      if (!entry.body) {
        if (throws ?? true) {
          throw kSuspend
        } else {
          return null
        }
      }

      return { status: entry.status, headers: entry.headers, body: entry.body }
    }

    _getObservable(observable, throws) {
      if (!rxjs.isObservable(observable)) {
        throw new Error(`invalid argument: observable (${observable})`)
      }

      const entry = this._getEntry(observable, ObservableEntry, observable)

      if (entry.error) {
        throw entry.error
      }

      if (entry.value === kEmpty) {
        if (throws ?? true) {
          throw kSuspend
        } else {
          return null
        }
      }

      return entry.value
    }

    _getRecord(key, state, throws) {
      if (typeof key !== 'string') {
        throw new Error(`invalid argument: key (${key})`)
      }

      if (!key || key === 'null' || key === 'undefined' || key === '[Object]') {
        return null
      }

      if (state == null) {
        state = key.startsWith('{') || key.includes('?') ? ds.record.PROVIDER : ds.record.SERVER
      } else if (typeof state === 'string') {
        state = ds.CONSTANTS.RECORD_STATE[state.toUpperCase()]
        if (state == null) {
          throw new Error(`invalid argument: state (${state})`)
        }
      }

      const entry = this._getEntry(key, RecordEntry, ds)

      if (entry.record.state < state) {
        if (throws ?? true) {
          throw kSuspend
        } else {
          return null
        }
      }

      return entry.record.data
    }

    _getHasRawAssetType(id, type, state, throws) {
      if (!type) {
        return null
      }
      const data = this._getRecord(
        id + ':asset.rawTypes?',
        state ?? ds.record.PROVIDER,
        throws ?? true
      )
      return data && data.value.includes(type) ? id : null
    }

    _getTimer(dueTime, dueValue = dueTime, undueValue = null) {
      dueTime = Number.isFinite(dueTime) ? dueTime : new Date(dueTime).valueOf()

      if (!Number.isFinite(dueTime)) {
        return undueValue
      }

      const nowTime = Date.now()

      if (nowTime >= dueTime) {
        return dueValue
      }

      this._getEntry(objectHash({ dueTime, dueValue, undueValue }), TimerEntry, dueTime - nowTime)

      return undueValue
    }
  }

  return weakCache((expression) => {
    let script
    try {
      script = new vm.Script(`
      "use strict";
      {
        const _ = (...args) => pipe(...args);
        _.asset = (type, state, throws) => (id) => nxt.asset(id, type, state, throws);
        _.ds = (postfix, state, throws) => (id) => nxt.ds(id + postfix, state, throws);
        _.timer = (dueTime) => (dueValue) => nxt.timer(dueTime, dueValue);
        ${expression}
      }
    `)
    } catch (err) {
      throw Object.assign(new Error(`failed to parse expression ${expression}`), { cause: err })
    }

    const context = vm.createContext({ ...globals })

    return (args) =>
      new rxjs.Observable((o) => {
        const exp = new Expression(context, script, expression, args, o)
        return () => {
          exp._destroy()
        }
      })
  })
}
