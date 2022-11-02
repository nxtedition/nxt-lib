const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')

function getDockerSecretsSync({ dir = '/run/secrets' } = {}) {
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

async function getDockerSecret(file, { dir = '/run/secrets', signal } = {}) {
  try {
    const [, ext] = file.split('.')
    const content = await fsp.readFile(path.join(dir, file), { encoding: 'utf8', signal })
    return ext === 'json' ? JSON.parse(content) : content
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null
    }
    throw err
  }
}

module.exports = {
  getDockerSecretsSync,
  getDockerSecret,
}
