const t = require('tap')
const {
  startRedirectingServer,
  startRedirectingWithBodyServer,
  startRedirectingChainServers,
  startRedirectingWithoutLocationServer,
  startRedirectingWithAuthorization,
  startRedirectingWithCookie,
  startRedirectingWithQueryParams,
} = require('./utils/redirecting-servers')
const { createReadable } = require('./utils/stream')
const { request } = require('../../undici/index.js')

t.test('should follow redirection after a HTTP 300', async (t) => {
  const server = await startRedirectingServer(t)

  const {
    statusCode,
    headers,
    body: bodyStream,
  } = await request(`http://${server}/300?key=value`, {
    maxRedirections: 10,
  })

  const body = await bodyStream.text()

  t.equal(statusCode, 200)
  t.notOk(headers.location)
  t.equal(body, `GET /5 key=value :: host@${server} connection@keep-alive`)
})

t.test('should follow redirection after a HTTP 300 default', async (t) => {
  const server = await startRedirectingServer(t)

  const { statusCode, headers, body: bodyStream } = await request(`http://${server}/300?key=value`)
  const body = await bodyStream.text()

  t.equal(statusCode, 200)
  t.notOk(headers.location)
  t.equal(body, `GET /5 key=value :: host@${server} connection@keep-alive`)
})

t.test('should follow redirection after a HTTP 301', async (t) => {
  const server = await startRedirectingServer(t)

  const {
    statusCode,
    headers,
    body: bodyStream,
  } = await request(`http://${server}/301`, {
    method: 'POST',
    body: 'REQUEST',
    maxRedirections: 10,
  })

  const body = await bodyStream.text()

  t.equal(statusCode, 200)
  t.notOk(headers.location)
  t.equal(body, `POST /5 :: host@${server} connection@keep-alive content-length@7 :: REQUEST`)
})

t.test('should follow redirection after a HTTP 302', async (t) => {
  const server = await startRedirectingServer(t)

  const {
    statusCode,
    headers,
    body: bodyStream,
  } = await request(`http://${server}/302`, {
    method: 'PUT',
    body: Buffer.from('REQUEST'),
    maxRedirections: 10,
  })

  const body = await bodyStream.text()

  t.equal(statusCode, 200)
  t.notOk(headers.location)
  t.equal(body, `PUT /5 :: host@${server} connection@keep-alive content-length@7 :: REQUEST`)
})

t.test('should follow redirection after a HTTP 303 changing method to GET', async (t) => {
  const server = await startRedirectingServer(t)

  const {
    statusCode,
    headers,
    body: bodyStream,
  } = await request(`http://${server}/303`, {
    method: 'PATCH',
    body: 'REQUEST',
    maxRedirections: 10,
  })

  const body = await bodyStream.text()

  t.equal(statusCode, 200)
  t.notOk(headers.location)
  t.equal(body, `GET /5 :: host@${server} connection@keep-alive`)
})

t.test(
  'should remove Host and request body related headers when following HTTP 303 (array)',
  async (t) => {
    const server = await startRedirectingServer(t)

    const {
      statusCode,
      headers,
      body: bodyStream,
    } = await request(`http://${server}/303`, {
      method: 'PATCH',
      headers: [
        'Content-Encoding',
        'gzip',
        'X-Foo1',
        '1',
        'X-Foo2',
        '2',
        'Content-Type',
        'application/json',
        'X-Foo3',
        '3',
        'Host',
        'localhost',
        'X-Bar',
        '4',
      ],
      maxRedirections: 10,
    })

    const body = await bodyStream.text()

    t.equal(statusCode, 200)
    t.notOk(headers.location)
    t.equal(
      body,
      `GET /5 :: host@${server} connection@keep-alive x-foo1@1 x-foo2@2 x-foo3@3 x-bar@4`,
    )
  },
)

t.test(
  'should remove Host and request body related headers when following HTTP 303 (object)',
  async (t) => {
    const server = await startRedirectingServer(t)

    const {
      statusCode,
      headers,
      body: bodyStream,
    } = await request(`http://${server}/303`, {
      method: 'PATCH',
      headers: {
        'Content-Encoding': 'gzip',
        'X-Foo1': '1',
        'X-Foo2': '2',
        'Content-Type': 'application/json',
        'X-Foo3': '3',
        Host: 'localhost',
        'X-Bar': '4',
      },
      maxRedirections: 10,
    })

    const body = await bodyStream.text()

    t.equal(statusCode, 200)
    t.notOk(headers.location)
    t.equal(
      body,
      `GET /5 :: host@${server} connection@keep-alive x-foo1@1 x-foo2@2 x-foo3@3 x-bar@4`,
    )
  },
)

t.test('should follow redirection after a HTTP 307', async (t) => {
  const server = await startRedirectingServer(t)

  const {
    statusCode,
    headers,
    body: bodyStream,
  } = await request(`http://${server}/307`, {
    method: 'DELETE',
    maxRedirections: 10,
  })

  const body = await bodyStream.text()

  t.equal(statusCode, 200)
  t.notOk(headers.location)
  t.equal(body, `DELETE /5 :: host@${server} connection@keep-alive`)
})

t.test('should follow redirection after a HTTP 308', async (t) => {
  const server = await startRedirectingServer(t)

  const {
    statusCode,
    headers,
    body: bodyStream,
  } = await request(`http://${server}/308`, {
    method: 'OPTIONS',
    maxRedirections: 10,
  })

  const body = await bodyStream.text()

  t.equal(statusCode, 200)
  t.notOk(headers.location)
  t.equal(body, `OPTIONS /5 :: host@${server} connection@keep-alive`)
})

t.test('should ignore HTTP 3xx response bodies', async (t) => {
  const server = await startRedirectingWithBodyServer(t)

  const {
    statusCode,
    headers,
    body: bodyStream,
  } = await request(`http://${server}/`, {
    maxRedirections: 10,
  })

  const body = await bodyStream.text()

  t.equal(statusCode, 200)
  t.notOk(headers.location)
  t.equal(body, 'FINAL')
})

t.test('should ignore query after redirection', async (t) => {
  const server = await startRedirectingWithQueryParams(t)

  const { statusCode, headers } = await request(`http://${server}/`, {
    maxRedirections: 10,
    query: { param1: 'first' },
  })

  t.equal(statusCode, 200)
  t.notOk(headers.location)
})

t.test('should follow a redirect chain up to the allowed number of times', async (t) => {
  const server = await startRedirectingServer(t)

  try {
    await request(`http://${server}/300`, {
      maxRedirections: 2,
    })
    t.fail()
  } catch (err) {
    t.ok(err)
  }
})

t.test('when a Location response header is NOT present', async (t) => {
  const redirectCodes = [300, 301, 302, 303, 307, 308]
  const server = await startRedirectingWithoutLocationServer(t)

  for (const code of redirectCodes) {
    try {
      const {
        statusCode,
        headers,
        body: bodyStream,
      } = await request(`http://${server}/${code}`, {
        maxRedirections: 10,
      })

      const body = await bodyStream.text()

      t.equal(statusCode, code)
      t.notOk(headers.location)
      t.equal(body.length, 0)

      t.fail()
    } catch (err) {
      t.ok(err)
    }
  }
})

t.test('should not follow redirects when using Readable request bodies', async (t) => {
  const server = await startRedirectingServer(t)

  try {
    await request(`http://${server}/301`, {
      method: 'POST',
      body: createReadable('REQUEST'),
      maxRedirections: 10,
    })
    t.fail()
  } catch (err) {
    t.ok(err)
  }
})

t.test('should follow redirections when going cross origin', async (t) => {
  const [server1] = await startRedirectingChainServers(t)

  const {
    statusCode,
    headers,
    body: bodyStream,
  } = await request(`http://${server1}`, {
    method: 'POST',
    maxRedirections: 10,
  })

  const body = await bodyStream.text()

  t.equal(statusCode, 200)
  t.notOk(headers.location)
  t.equal(body, 'POST')
})

t.test('should handle errors (promise)', async (t) => {
  try {
    await request('http://localhost:0', { maxRedirections: 10 })
    t.fail('Did not throw')
  } catch (error) {
    t.match(error.code, /EADDRNOTAVAIL|ECONNREFUSED/)
  }
})

t.test('removes authorization header on third party origin', async (t) => {
  const [server1] = await startRedirectingWithAuthorization(t, 'secret')
  const { body: bodyStream } = await request(`http://${server1}`, {
    maxRedirections: 10,
    headers: {
      authorization: 'secret',
    },
  })

  const body = await bodyStream.text()

  t.equal(body, '')
})

t.test('removes cookie header on third party origin', async (t) => {
  const [server1] = await startRedirectingWithCookie(t, 'a=b')
  const { body: bodyStream } = await request(`http://${server1}`, {
    maxRedirections: 10,
    headers: {
      cookie: 'a=b',
    },
  })

  const body = await bodyStream.text()

  t.equal(body, '')
})
