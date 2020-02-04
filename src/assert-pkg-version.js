const lockfile = require('@yarnpkg/lockfile')
const semver = require('semver')
const fs = require('fs')
const fp = require('lodash/fp')

// Usage:
// ensurePackageVersion('./yarn.lock', {
//   '@yarnpkg/lockfile': '1.x',
//   'semver': '>=7',
// })

module.exports = function ensurePackageVersion (lockfilePath, assertions) {
  const contents = fs.readFileSync(lockfilePath, { encoding: 'utf8' })
  const parsed = lockfile.parse(contents)
  const { type, object } = parsed

  if (type !== 'success') {
    const error = new Error('error parsing lockfile')
    error.parsed = parsed
    throw error
  }

  const versions = fp.pipe(
    fp.toPairs,
    fp.map(([name, info]) => [
      name.slice(0, name.lastIndexOf('@')),
      info.version
    ]),
    fp.fromPairs
  )(object)

  for (const [name, condition] of Object.entries(assertions)) {
    const version = versions[name]

    if (!version) {
      const error = new Error('missing package')
      error.packageName = name
      error.expected = condition
      throw error
    }

    if (!semver.satisfies(version, condition)) {
      const error = new Error('wrong package version')
      error.packageName = name
      error.packageVersion = version
      error.expected = condition
      throw error
    }
  }
}
