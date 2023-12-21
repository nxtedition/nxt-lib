import { Worker, isMainThread } from 'worker_threads'

if (isMainThread) {
  new Worker('./tmp.mjs')
    .on('error', err => {
      console.error("### 1", err)
    })
} else {
  process.nextTick(() => {
    throw new Error("ASD")
  })
  process.on('beforeExit', () => {
    console.error("### 2")
  })
  // process.on('uncaughtException', err => {
  //   console.error("### 2", err)
  // })
}
