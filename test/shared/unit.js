const { test } = require('tap')
const { alloc, reader, writer } = require('../../shared.js')
const { setTimeout } = require('node:timers/promises')

test(`read without write`, (t) => {
  const shared = alloc(256)
  const read = reader(shared)

  read(() => {
    t.fail('read should do nothing when there is no write')
  })

  t.end()
})

test(`write then read`, async (t) => {
  t.plan(2)

  const shared = alloc(256)
  const write = writer(shared)
  const read = reader(shared)

  const writeValue = 42
  const writeSize = 4

  write(writeSize, (dataPos, buffer) => {
    buffer.writeInt32LE(writeValue, dataPos)
    return dataPos + writeSize
  })

  read((buffer, dataPos, dataLength) => {
    const readValue = buffer.readInt32LE(dataPos)
    const readSize = dataLength
    t.same(readValue, writeValue)
    t.same(readSize, writeSize)
  })

  t.end()
})

test(`multiple writes and reads`, async (t) => {
  t.plan(10)
  t.setTimeout(3e3)

  const shared = alloc(256)
  const write = writer(shared)
  const read = reader(shared)

  for (let i = 0; i < 5; i++) {
    const writeValue = 42 + i
    const writeSize = 64

    write(writeSize, (dataPos, buffer) => {
      buffer.writeInt32LE(writeValue, dataPos)
      return dataPos + writeSize
    })

    read((buffer, dataPos, dataLength) => {
      const readValue = buffer.readInt32LE(dataPos)
      const readSize = dataLength
      t.same(readValue, writeValue)
      t.same(readSize, writeSize)
    })
  }

  t.end()
})

test(`queued writes then reads`, async (t) => {
  t.plan(11)

  const shared = alloc(256)
  const write = writer(shared)
  const read = reader(shared)

  const writeValue = 42
  const writeSize = 64

  const numWrites = 5
  let queued = false
  for (let i = 0; i < numWrites; i++) {
    const done = write(writeSize, (dataPos, buffer) => {
      buffer.writeInt32LE(writeValue, dataPos)
      return dataPos + writeSize
    })

    if (!done) {
      queued = true
    }
  }

  t.ok(queued)

  let numReads = 0
  while (numReads < numWrites) {
    read((buffer, dataPos, dataLength) => {
      numReads++
      const readValue = buffer.readInt32LE(dataPos)
      const readSize = dataLength
      t.same(readValue, writeValue)
      t.same(readSize, writeSize)
    })
    await setTimeout(200)
  }

  t.end()
})

test(`queue big writes then read`, async (t) => {
  t.plan(7)

  const shared = alloc(5 * 1024 * 1024)
  const write = writer(shared)
  const read = reader(shared)

  const writeValue = 42 + 1
  const writeSize = 2 * 1024 * 1024 + 5

  const numWrites = 3
  let queued = false
  for (let i = 0; i < numWrites; i++) {
    const done = write(writeSize, (dataPos, buffer) => {
      buffer.writeInt32LE(writeValue, dataPos)
      return dataPos + writeSize
    })

    if (!done) {
      queued = true
    }
  }

  t.ok(queued)

  let numReads = 0
  while (numReads < numWrites) {
    read((buffer, dataPos, dataLength) => {
      numReads++
      const readValue = buffer.readInt32LE(dataPos)
      const readSize = dataLength
      t.same(readValue, writeValue)
      t.same(readSize, writeSize)
    })
    await setTimeout(200)
  }

  t.end()
})
