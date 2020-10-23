/* globals WeakRef FinalizationRegistry */

module.exports = function weakCache (fn) {
  const cache = new Map()
  const finalizationRegistry = new FinalizationRegistry(name => {
    const ref = cache.get(name)
    if (ref !== undefined && ref.deref() === undefined) {
      cache.delete(name)
    }
  })
  return name => {
    const ref = cache.get(name)
    if (ref !== undefined) {
      const deref = ref.deref()
      if (deref !== undefined) {
        return deref
      }
    }
    const value = fn(name)
    cache.set(name, new WeakRef(value))
    finalizationRegistry.register(value, name)
    return value
  }
}
