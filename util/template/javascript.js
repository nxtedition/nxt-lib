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

    this.timer = null
  }
}

class FetchEntry {
  constructor(key, refresh, { resource, options }) {
    this.key = key
    this.counter = null

    this.refresh = refresh
    this.ac = new AbortController()
    this.signal = this.ac.signal
    this.body = null
    this.status = null
    this.error = null

    // TODO (fix): options.signal
    // TODO (fix): cache...
    // TODO (fix): expire...

    undici
      .fetch(resource, { ...options, signal: this.signal })
      .then(async (res) => {
        if (this.refresh) {
          // TODO (fix): max size...
          this.body = Buffer.from(await res.arrayBuffer())
          this.status = res.status
          this.headers = res.headers
          this.refresh()
        }
      })
      .catch((err) => {
        if (this.refresh) {
          this.error = err
          this.refresh()
        }
      })
  }

  dispose() {
    this.refresh = null

    this.ac.abort()
    this.ac = null
  }
}

class RecordEntry {
  constructor(key, refresh, ds) {
    this.key = key
    this.counter = null

    this.refresh = refresh
    this.record = ds.record.getRecord(key)

    if (this.record.subscribe) {
      this.record.subscribe(this.refresh)
    } else {
      this.record.on('update', this.refresh)
    }
  }

  dispose() {
    this.record.unref()
    if (this.record.unsubscribe) {
      this.record.unsubscribe(this.refresh)
    } else {
      this.record.off('update', this.refresh)
    }

    this.record = null
    this.refresh = null
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
    this.refresh = null
  }
}

class PromiseEntry {
  constructor(key, refresh, promise) {
    this.key = key
    this.counter = null
    this.value = kEmpty
    this.error = null
    this.refresh = refresh

    promise.then(
      (value) => {
        if (this.refresh) {
          this.value = value
          this.refresh()
        }
      },
      (err) => {
        if (this.refresh) {
          this.error = err
          this.refresh()
        }
      }
    )
  }

  dispose() {
    this.refresh = null
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
  _: require('lodash'),
  moment: require('moment-timezone'),
  Timecode: require('smpte-timecode'),
  datefns,
  JSON5,
  pipe,
  $: null,
  nxt: null,
}

function proxify(value, expression, handler) {
  if (!value) {
    return value
  } else if (rxjs.isObservable(value)) {
    return proxify(expression.observe(value), expression)
  } else if (typeof value?.then === 'function') {
    return proxify(expression.wait(value), expression, handler)
  } else if (typeof value === 'object') {
    return new Proxy(value, handler)
  } else {
    return value
  }
}

const MAP_POOL = []

function makeWrapper(expression) {
  const handler = {
    get: (target, prop) => proxify(target[prop], this),
  }
  return (value) => proxify(value, expression, handler)
}

module.exports = ({ ds, proxify, compiler }) => {
  class Expression {
    constructor(context, script, expression, args, observer) {
      this._context = context
      this._expression = expression
      this._observer = observer
      this._script = script

      // TODO (perf): This could be faster by using an array + indices.
      // A bit similar to how react-hooks works.
      this._entries = null
      this._refreshing = false
      this._counter = 0
      this._value = kEmpty
      this._disposing = false
      this._destroyed = false
      this._subscription = null
      this._args = kEmpty
      this._wrap = null

      if (rxjs.isObservable(args)) {
        this._subscription = args.subscribe({
          next: (args) => {
            this._args = proxify ? this.wrap(args) : args
            this._refresh()
          },
          error: (err) => {
            this._observer.error(err)
            this._subscription = null
          },
          complete: () => {
            this._subscription = null
          },
        })
      } else {
        this._args = proxify ? this.wrap(args) : args
        this._refreshNT(this)
      }
    }

    wrap(value) {
      this._wrap ??= makeWrapper(this)
      return this._wrap(value)
    }

    suspend() {
      throw kSuspend
    }

    fetch(url, init, throws) {
      return this._getFetch(url, init, throws)
    }

    observe(observable, throws) {
      return this._getObservable(observable, throws)
    }

    wait(promise, throws) {
      return this._getWait(promise, throws)
    }

    ds(id, state, throws) {
      return this._getRecord(id, state, throws)
    }

    _ds(key, postfix, state, throws) {
      return !key || typeof key !== 'string'
        ? null
        : this._getRecord(postfix ? key + postfix : key, state, throws)
    }

    asset(id, type, state, throws) {
      return this._getHasRawAssetType(id, type, state, throws)
    }

    _asset(id, type, state, throws) {
      if (!type || typeof type !== 'string') {
        throw new Error(`invalid argument: type (${type})`)
      }

      return !id || typeof id !== 'string'
        ? null
        : this._getHasRawAssetType(id, type, state, throws)
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

      if (this._entries) {
        for (const entry of this._entries.values()) {
          entry.dispose()
        }
        this._entries.clear()

        if (MAP_POOL.length < 1024) {
          MAP_POOL.push(this._entries)
        }

        this._entries = null
      }
    }

    _refreshNT(self) {
      self._refreshing = false

      if (self._destroyed || self._disposing || self._args === kEmpty) {
        return
      }

      self._counter = (self._counter + 1) & maxInt

      // TODO (fix): freeze?
      self._context.$ = self._args
      self._context.nxt = self
      try {
        compiler.current = this
        const value = self._script.runInContext(self._context)
        if (value !== self._value) {
          self._value = value
          self._observer.next(value)
        }
      } catch (err) {
        if (err === kSuspend) {
          return
        }

        self._observer.error(
          Object.assign(new Error('expression failed'), {
            cause: err,
            data: self._expression,
          })
        )
      } finally {
        compiler.current = null

        self._context.$ = null
        self._context.nxt = null

        self._disposing = true

        if (self._entries) {
          for (const entry of self._entries.values()) {
            if (entry.counter !== self._counter) {
              entry.dispose()
              self._entries.delete(entry.key)
            }
          }
          if (self._entries.size === 0) {
            self._entries = null
          }
        }

        // TODO (perf): Make this work.
        // if (!self._entries) {
        //   self._args = null
        // }

        self._disposing = false
      }
    }

    _refresh = () => {
      if (this._refreshing || this._destroyed || this._disposing || this._args === kEmpty) {
        return
      }

      this._refreshing = true
      process.nextTick(this._refreshNT, this)
    }

    _getEntry(key, Entry, opaque) {
      this._entries ??= MAP_POOL.pop() ?? new Map()
      let entry = this._entries.get(key)
      if (!entry) {
        entry = new Entry(key, this._refresh, opaque)
        this._entries.set(key, entry)
      }
      entry.counter = this._counter
      return entry
    }

    _getFetch(resource, options, throws) {
      const key = JSON.stringify({ resource, options })
      const entry = this._getEntry(key, FetchEntry, { resource, options })

      if (entry.error) {
        throw entry.error
      }

      if (!entry.status) {
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

    _getWait(promise, throws) {
      if (typeof promise?.then !== 'function') {
        throw new Error(`invalid argument: Promise (${promise})`)
      }

      const entry = this._getEntry(promise, PromiseEntry, promise)

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
      if (!key || typeof key !== 'string') {
        throw new Error(`invalid argument: key (${key})`)
      }

      if (state == null) {
        state =
          key.startsWith('{') || key.includes('?')
            ? ds.record.STATE.PROVIDER
            : ds.record.STATE.SERVER
      } else if (typeof state === 'string') {
        state = ds.record.STATE[state.toUpperCase()]
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
      if (!id || typeof id !== 'string') {
        throw new Error(`invalid argument: id (${id})`)
      }

      if (!type || typeof type !== 'string') {
        throw new Error(`invalid argument: type (${type})`)
      }

      const data = this._getRecord(
        id + ':asset.rawTypes?',
        state ?? ds.record.PROVIDER,
        throws ?? true
      )
      return data && Array.isArray(data.value) && data.value.includes(type) ? id : null
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
        _.asset = (type, state, throws) => (id) => nxt._asset(id, type, state, throws);
        _.ds = (postfix, state, throws) => (id) => nxt._ds(id, postfix, state, throws);
        _.timer = (dueTime) => (dueValue) => nxt.timer(dueTime, dueValue);
        _.fetch = (options, throws) => (resource) => nxt.fetch(resource, options, throws);
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
