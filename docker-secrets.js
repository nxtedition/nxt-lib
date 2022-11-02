const fs = require('fs')
const path = require('path')

module.exports = function getDockerSecrets({ dir = '/run/secrets' } = {}) {
  let files
  try {
    files = fs.readdirSync(dir)
  } catch (err) {
    if (err.code === 'ENOENT') {
      return {}
    }
    throw err
  }

  const secrets = {}
  for (const file of files) {
    const [name, ext] = file.split('.')
    const content = fs.readFileSync(path.join(dir, file), { encoding: 'utf8' })
    secrets[name] = ext === 'json' ? JSON.parse(content) : content
  }
  return secrets
}
