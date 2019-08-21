## Typical HTTP Server

```js
const compose = require('koa-compose')
const { request } = require('@nxtedition/lib/http')
const { createLogger } = require('@nxtedition/lib/logger')
const config = require('./config')
const createError = require('http-errors')

const middleware = compose([
  request,
  require('./myApp'),
  () => {
    throw new createError.NotFound()
  }
])
const logger = createLogger(config.logger, () => new Promise((resolve, reject) => {
  server.close(err => err ? reject(err) : resolve())
}))
const server = http
  .createServer((req, res) => middleware({ req, res, config, logger }))
  .listen(config.http.port)
```
