const { test } = require('tap')
const { createServer } = require('http')
const { request } = require('../../lib/undici/index.js')

test('retry status', (t) => {
  t.plan(3)

  let x = 0
  const server = createServer((req, res) => {
    t.pass()
    res.statusCode = x++ ? 200 : 429
    res.end('asd')
  })

  t.teardown(server.close.bind(server))
  server.listen(0, async () => {
    const ures = await request(`http://localhost:${server.address().port}`)
    await ures.dump()
    t.equal(ures.statusCode, 200)
  })
})

test('retry destroy pre response', (t) => {
  t.plan(3)

  let x = 0
  const server = createServer((req, res) => {
    t.pass()
    if (x++) {
      res.end('asd')
    } else {
      res.destroy()
    }
  })

  t.teardown(server.close.bind(server))
  server.listen(0, async () => {
    const ures = await request(`http://localhost:${server.address().port}`)
    await ures.dump()
    t.equal(ures.statusCode, 200)
  })
})

test('retry destroy post response', (t) => {
  t.plan(4)

  let x = 0
  const server = createServer((req, res) => {
    if (x === 0) {
      t.pass()
      res.setHeader('etag', 'asd')
      res.write('asd')
      setTimeout(() => {
        res.destroy()
      }, 1e2)
    } else if (x === 1) {
      t.same(req.headers.range, 'bytes=3-')
      res.setHeader('content-range', 'bytes 3-6/6')
      res.setHeader('etag', 'asd')
      res.statusCode = 206
      res.end('end')
    }
    x++
  })

  t.teardown(server.close.bind(server))
  server.listen(0, async () => {
    const ures = await request(`http://localhost:${server.address().port}`)
    t.equal(ures.statusCode, 200)
    const text = await ures.text().catch((err) => console.error(err))
    t.equal(text, 'asdend')
  })
})
