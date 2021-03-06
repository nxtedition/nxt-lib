const level = require('level')
const fs = require('fs')
const net = require('net')
const path = require('path')
const multileveldown = require('multileveldown')
const { pipeline } = require('stream')

module.exports = function (dir, opts = {}) {
  const sockPath = process.platform === 'win32'
    ? '\\\\.\\pipe\\level-party\\' + path.resolve(dir)
    : path.join(dir, 'level-party.sock')

  const client = multileveldown.client(opts)

  client.open(tryConnect)

  return client

  function tryConnect () {
    if (!client.isOpen()) {
      return
    }

    const socket = net.connect(sockPath)

    // we pass socket as the ref option so we dont hang the event loop
    pipeline(socket, client.createRpcStream({ ref: socket }), socket, () => {
      if (!client.isOpen()) {
        return
      }

      const db = level(dir, opts, (err) => {
        if (err) {
          client.emit('reconnect', err)
          setTimeout(tryConnect, 100)
          return
        }

        client.emit('connect', err)

        fs.unlink(sockPath, (err) => {
          if (err && err.code !== 'ENOENT') {
            db.emit('error', err)
            return
          }

          if (!client.isOpen()) {
            return
          }

          const sockets = new Set()
          const server = net.createServer((socket) => {
            // TODO (fix): Is this needed?
            socket?.unref()

            sockets.add(socket)
            pipeline(socket, multileveldown.server(db), socket, (err) => {
              if (err) {
                // TODO (fix): How to handle?
                client.emit('error', err)
              }
              sockets.delete(socket)
            })
          })

          client.close = (cb) => {
            for (const socket of sockets) {
              socket.destroy()
            }

            server.close(() => {
              db.close(cb)
            })
          }

          client.emit('leader')
          client.forward(db)

          server.listen(sockPath, () => {
            // TODO (fix): Is this needed?
            server?.unref()

            if (client.isFlushed()) {
              return
            }

            const socket = net.connect(sockPath)

            pipeline(socket, client.createRpcStream(), socket, (err) => {
              if (err) {
                // TODO (fix): How to handle?
                client.emit('error', err)
              }
            })

            client.once('flush', () => {
              socket.destroy()
            })
          })
        })
      })
    })
  }
}
