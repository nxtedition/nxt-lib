const { test } = require('tap')
const { createServer } = require('http')
const { request } = require('../../lib/undici/index.js')

test('simple request', (t) => {
  t.plan(1)
  const server = createServer((req, res) => {
    res.end('asd')
  })

  t.teardown(server.close.bind(server))
  server.listen(0, async () => {
    const body = await request(`http://localhost:${server.address().port}`)
    let str = ''
    for await (const chunk of body) {
      str += chunk
    }
    t.equal(str, 'asd')
  })
})
