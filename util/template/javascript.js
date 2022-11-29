const weakCache = require('../../weakCache')
const rxjs = require('rxjs')
const vm = require('node:vm')
const objectHash = require('object-hash')
const datefns = require('date-fns')
const JSON5 = require('json5')

const kSuspend = Symbol('kSuspend')
const kEmpty = Symbol('kEmpty')
const maxInt = 2147483647

function makeTimerEntry(key, refresh, delay) {
  return {
    key,
    counter: null,
    timer: setTimeout(refresh, delay),
    dispose: disposeTimerEntry,
  }
}

function disposeTimerEntry() {
  clearTimeout(this.timer)
  this.timer = null
}

function makeRecordEntry(key, refresh, ds) {
  const entry = {
    key,
    counter: null,
    refresh,
    record: ds.record.getRecord(key),
    dispose: disposeRecordEntry,
  }
  entry.record.on('update', refresh)
  return entry
}

function disposeRecordEntry() {
  this.record.unref()
  this.record.off('update', this.refresh)
  this.record = null
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

module.exports = ({ ds } = {}) => {
  class Expression {
    constructor(context, script, expression, args$, observer) {
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
      this._destroyed = false

      if (rxjs.isObservable(args$)) {
        this._args = {}
        this._subscription = args$.subscribe({
          next: (args) => {
            this._args = args
            this._refresh()
          },
          error: (err) => {
            this._observer.error(err)
          },
        })
      } else {
        this._args = args$
        this._subscription = null
      }

      this._refreshNT(this)
    }

    suspend() {
      throw kSuspend
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
      for (const entry of this._entries.values()) {
        entry.dispose()
      }
      this._entries.clear()
      this._subscription?.unsubscribe()
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
            Object.assign(new Error('expression failed'), {
              cause: err,
              data: { expression: self._expression, args: self._args },
            })
          )
        }
      } finally {
        self._context.$ = null
        self._context.nxt = null
      }

      for (const entry of self._entries.values()) {
        if (entry.counter !== self._counter) {
          entry.dispose()
          self._entries.delete(entry.key)
        }
      }
    }

    _refresh = () => {
      if (!this._refreshing && !this._destroyed) {
        this._refreshing = true
        process.nextTick(this._refreshNT, this)
      }
    }

    _getEntry(key, factory, opaque) {
      let entry = this._entries.get(key)
      if (!entry) {
        entry = factory(key, this._refresh, opaque)
        this._entries.set(key, entry)
      }
      entry.counter = this._counter
      return entry
    }

    _getRecord(key, state, throws) {
      if (state == null) {
        state = key.startsWith('{') || key.includes('?') ? ds.record.PROVIDER : ds.record.SERVER
      } else if (typeof state === 'string') {
        state = ds.CONSTANTS.RECORD_STATE[state.toUpperCase()]
        if (state == null) {
          throw new Error(`invalid argument: state (${state})`)
        }
      }

      const entry = this._getEntry(key, makeRecordEntry, ds)

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
      const data = this._getRecord(
        id + ':asset.rawTypes?',
        state ?? ds.record.PROVIDER,
        throws ?? true
      )
      return data && data.value.includes(type) ? id : null
    }

    _getTimer(dueTime, dueValue = dueTime, undueValue = null) {
      dueTime = Number.isFinite(dueTime) ? dueTime : new Date(dueTime).valueOf()

      const nowTime = Date.now()

      if (!Number.isFinite(dueTime)) {
        return undueValue
      }

      if (nowTime >= dueTime) {
        return dueValue
      }

      this._getEntry(
        objectHash({ dueTime, dueValue, undueValue }),
        makeTimerEntry,
        dueTime - nowTime
      )

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
      throw new Error(`failed to parse expression ${expression}`, { cause: err })
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
