const { createServer } = require('http')
const { request } = require('../../undici/index.js')
const send = require('send')
const fs = require('fs')
const assert = require('assert')
const crypto = require('crypto')

const filePath = '/Users/robertnagy/Downloads/a66f220981c97bad.mp4'

let currentResponse
const server = createServer((req, res) => {
  if (Math.random() > 0.5) {
    res.statusCode = 429
    res.end()
    return
  }

  currentResponse = res
  send(req, filePath).pipe(res)
})

server.listen(0, async () => {
  let expected
  {
    const hasher = crypto.createHash('md5')
    for await (const chunk of fs.createReadStream(filePath)) {
      hasher.update(chunk)
    }
    expected = hasher.digest('hex')
  }

  for (let n = 0; n < 10e3; n++) {
    const body = await request(`http://localhost:${server.address().port}`)
    const hasher = crypto.createHash('md5')
    for await (const chunk of body) {
      if (Math.random() > 0.5) {
        currentResponse.destroy()
        continue
      }

      hasher.update(chunk)
    }
    const actual = hasher.digest('hex')
    assert.equal(actual, expected)
    console.log('# ', n)
  }
})
