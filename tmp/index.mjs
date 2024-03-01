import { makeCouch } from '../couch.js'

const couch = makeCouch('http://localhost:6100/nxt')

for await (const changes of couch.changes({ live: false, batchSize: 8, batched: true, seqInterval: 8 })) {
  console.log("!!", changes.length)
}
