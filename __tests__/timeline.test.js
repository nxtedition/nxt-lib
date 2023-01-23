const test = require('node:test')
const assert = require('node:assert')
const { eventsToTimeline, timelineToCommands } = require('../timeline.js')

const evt = (start, end, source, prop, value = 1) => ({
  start,
  end,
  source,
  data: { [prop]: value },
})

test('eventsToTimeline', async (t) => {
  await t.test('finite event', (t) => {
    assert.deepEqual(eventsToTimeline([evt(1, 2, 'a', 'x')]), [
      { time: 1, source: 'a', data: { x: 1 } },
      { time: 2, source: 'a' },
      { time: 7 },
    ])
  })

  await t.test('infinite end', (t) => {
    assert.deepEqual(eventsToTimeline([evt(0, Infinity, 'a', 'x')]), [
      { time: 0, source: 'a', data: { x: 1 } },
      { time: Infinity },
    ])
  })

  await t.test('revert to active', (t) => {
    assert.deepEqual(eventsToTimeline([evt(0, Infinity, 'a', 'x'), evt(1, 2, 'b', 'y')]), [
      { time: 0, source: 'a', data: { x: 1 } },
      { time: 1, source: 'b', data: { x: 1, y: 1 } },
      { time: 2, source: 'a', data: { x: 1 } },
      { time: Infinity },
    ])
  })

  await t.test('same start take last', (t) => {
    assert.deepEqual(
      eventsToTimeline([evt(0, 2, 'a', 'x'), evt(0, 1, 'b', 'y'), evt(0, 1, 'c', 'z')]),
      [
        { time: 0, source: 'c', data: { x: 1, y: 1, z: 1 } },
        { time: 1, source: 'a', data: { x: 1 } },
        { time: 2, source: 'a' },
        { time: 7 },
      ]
    )
  })

  await t.test('revert twice', (t) => {
    assert.deepEqual(
      eventsToTimeline([evt(0, 5, 'a', 'x'), evt(1, 2, 'b', 'x'), evt(3, 4, 'a', 'y')]),
      [
        { time: 0, source: 'a', data: { x: 1 } },
        { time: 1, source: 'b', data: { x: 1 } },
        { time: 2, source: 'a', data: { x: 1 } },
        { time: 3, source: 'a', data: { x: 1, y: 1 } },
        { time: 4, source: 'a', data: { x: 1 } },
        { time: 5, source: 'a' },
        { time: 10 },
      ]
    )
  })

  await t.test('partial preload', (t) => {
    assert.deepEqual(eventsToTimeline([evt(0, 1, 'a', 'x'), evt(8, 9, 'b', 'y')]), [
      { time: 0, source: 'a', data: { x: 1 } },
      { time: 1, source: 'a' },
      { time: 6 },
      { time: 8, source: 'b', data: { y: 1 } },
      { time: 9, source: 'b' },
      { time: 14 },
    ])
  })

  await t.test('complex', (t) => {
    assert.deepEqual(
      eventsToTimeline([evt(0, 5, 'a', 'x'), evt(1, 3, 'b', 'x', 2), evt(2, 4, 'a', 'y')]),
      [
        { time: 0, source: 'a', data: { x: 1 } },
        { time: 1, source: 'b', data: { x: 2 } },
        { time: 2, source: 'a', data: { x: 2, y: 1 } },
        { time: 3, source: 'a', data: { x: 1, y: 1 } },
        { time: 4, source: 'a', data: { x: 1 } },
        { time: 5, source: 'a' },
        { time: 10 },
      ]
    )
  })
})

test('timelineToCommands', async (t) => {
  await t.test('finite event', (t) => {
    assert.deepEqual(timelineToCommands(eventsToTimeline([evt(1, 2, 'a', 'x')])), [
      { command: 'load', time: -4, source: 'a', data: { x: 1 } },
      { command: 'play', time: 1 },
      { command: 'stop', time: 2 },
      { command: 'clear', time: 7 },
    ])
  })

  await t.test('infinite end', (t) => {
    assert.deepEqual(timelineToCommands(eventsToTimeline([evt(0, Infinity, 'a', 'x')])), [
      { command: 'load', time: -5, source: 'a', data: { x: 1 } },
      { command: 'play', time: 0 },
      { command: 'clear', time: Infinity },
    ])
  })

  await t.test('revert to active', (t) => {
    assert.deepEqual(
      timelineToCommands(eventsToTimeline([evt(0, Infinity, 'a', 'x'), evt(1, 2, 'b', 'y')])),
      [
        { command: 'load', time: -5, source: 'a', data: { x: 1 } },
        { command: 'play', time: 0 },
        { command: 'play', time: 1, source: 'b', data: { x: 1, y: 1 } },
        { command: 'play', time: 2, source: 'a', data: { x: 1 } },
        { command: 'clear', time: Infinity },
      ]
    )
  })

  await t.test('update when same source', (t) => {
    assert.deepEqual(
      timelineToCommands(eventsToTimeline([evt(0, Infinity, 'a', 'x'), evt(1, 2, 'a', 'y')])),
      [
        { command: 'load', time: -5, source: 'a', data: { x: 1 } },
        { command: 'play', time: 0 },
        { command: 'update', time: 1, data: { x: 1, y: 1 } },
        { command: 'update', time: 2, data: { x: 1 } },
        { command: 'clear', time: Infinity },
      ]
    )
  })

  await t.test('no preloading', (t) => {
    assert.deepEqual(
      timelineToCommands(eventsToTimeline([evt(0, 1, 'a', 'x'), evt(3, 4, 'b', 'y')])),
      [
        { command: 'load', time: -5, source: 'a', data: { x: 1 } },
        { command: 'play', time: 0 },
        { command: 'stop', time: 1 },
        { command: 'play', time: 3, source: 'b', data: { y: 1 } },
        { command: 'stop', time: 4 },
        { command: 'clear', time: 9 },
      ]
    )
  })

  await t.test('partial preloading', (t) => {
    assert.deepEqual(
      timelineToCommands(eventsToTimeline([evt(0, 1, 'a', 'x'), evt(8, 9, 'b', 'y')])),
      [
        { command: 'load', time: -5, source: 'a', data: { x: 1 } },
        { command: 'play', time: 0 },
        { command: 'stop', time: 1 },
        { command: 'clear', time: 6 }, // we can get rid of this, should we?
        { command: 'load', time: 6, source: 'b', data: { y: 1 } },
        { command: 'play', time: 8 },
        { command: 'stop', time: 9 },
        { command: 'clear', time: 14 },
      ]
    )
  })

  await t.test('full preloading', (t) => {
    assert.deepEqual(
      timelineToCommands(eventsToTimeline([evt(0, 1, 'a', 'x'), evt(20, 21, 'b', 'y')])),
      [
        { command: 'load', time: -5, source: 'a', data: { x: 1 } },
        { command: 'play', time: 0 },
        { command: 'stop', time: 1 },
        { command: 'clear', time: 6 },
        { command: 'load', time: 15, source: 'b', data: { y: 1 } },
        { command: 'play', time: 20 },
        { command: 'stop', time: 21 },
        { command: 'clear', time: 26 },
      ]
    )
  })

  await t.test('complex', (t) => {
    assert.deepEqual(
      timelineToCommands(
        eventsToTimeline([
          evt(0, 5, 'a', 'x'),
          evt(1, 3, 'b', 'x'),
          evt(2, 4, 'a', 'y'),
          evt(7, 8, 'a', 'y'),
        ])
      ),
      [
        { command: 'load', time: -5, source: 'a', data: { x: 1 } },
        { command: 'play', time: 0 },
        { command: 'play', time: 1, source: 'b', data: { x: 1 } },
        { command: 'play', time: 2, source: 'a', data: { x: 1, y: 1 } },
        { command: 'update', time: 4, data: { x: 1 } },
        { command: 'stop', time: 5 },
        { command: 'play', time: 7, source: 'a', data: { y: 1 } },
        { command: 'stop', time: 8 },
        { command: 'clear', time: 13 },
      ]
    )
  })

  await t.test('complex + load', (t) => {
    assert.deepEqual(
      timelineToCommands(
        eventsToTimeline([
          evt(0, 50, 'a', 'x'),
          evt(10, 30, 'b', 'x', 2),
          evt(20, 40, 'a', 'y'),
          evt(70, 80, 'a', 'y'),
        ])
      ),
      [
        { command: 'load', time: -5, source: 'a', data: { x: 1 } },
        { command: 'play', time: 0 },
        { command: 'play', time: 10, source: 'b', data: { x: 2 } },
        { command: 'play', time: 20, source: 'a', data: { x: 2, y: 1 } },
        { command: 'update', time: 30, data: { x: 1, y: 1 } },
        { command: 'update', time: 40, data: { x: 1 } },
        { command: 'stop', time: 50 },
        { command: 'clear', time: 55 },
        { command: 'load', time: 65, source: 'a', data: { y: 1 } },
        { command: 'play', time: 70 },
        { command: 'stop', time: 80 },
        { command: 'clear', time: 85 },
      ]
    )
  })
})
