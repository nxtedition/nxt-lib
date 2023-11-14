import fp from 'lodash/fp.js'

const STOP_TIME = 5
const PRELOAD_TIME = 5

// Events must have start/end/source/data, and should be sorted by start
export function eventsToTimeline(events) {
  const timeline = []
  events = [...events]
  let active = []

  while (active.length || events.length) {
    const activeEnd = Math.min(...active.map((x) => x.end))
    if (active.length && (!events.length || activeEnd < events.at(0).start)) {
      // current has ended
      const prev = active.at(-1)
      active = active.filter((e) => e.end > activeEnd)
      if (active.length) {
        // reverting to previously active
        timeline.push({
          ...fp.omit(['start', 'end'], active.at(-1)),
          data: Object.assign({}, ...active.map((x) => x.data)),
          time: activeEnd,
        })
      } else {
        // stop active
        if (activeEnd < Infinity) {
          timeline.push({ ...fp.omit(['start', 'end', 'data'], prev), time: activeEnd })
        }
        // clear
        const clearTime = activeEnd + STOP_TIME
        if (!events.length || clearTime < events.at(0).start) {
          timeline.push({ ...fp.omit(['start', 'end', 'source', 'data'], prev), time: clearTime })
        }
      }
    } else {
      // start next
      const nextStart = events.at(0).start
      let next
      do {
        next = events.shift()
        active.push(next)
      } while (events.length && nextStart === events.at(0).start)

      timeline.push({
        ...fp.omit(['start', 'end'], next),
        data: Object.assign({}, ...active.map((x) => x.data)),
        time: next.start,
      })
    }
  }
  return timeline
}

export function timelineToCommands(timeline) {
  const commands = []
  let current = { time: -Infinity }
  for (let i = 0; i < timeline.length; i++) {
    const next = timeline[i]
    const canPreload =
      next.source && next.data && current.source == null && current.time < next.time
    if (canPreload) {
      const loadTime = Math.max(current.time, next.time - PRELOAD_TIME)
      commands.push(
        {
          command: 'load',
          ...next,
          time: loadTime,
        },
        {
          command: 'play',
          ...fp.omit(['source', 'data'], next),
        },
      )
    } else if (next.source) {
      if (next.source !== current.source || !current.data) {
        commands.push({
          command: 'play',
          ...next,
        })
      } else if (!fp.isEqual(current.data, next.data)) {
        commands.push({
          command: next.data ? 'update' : 'stop',
          ...fp.omit(['source'], next),
        })
      }
    } else {
      commands.push({
        command: 'clear',
        ...next,
      })
    }
    current = next
  }

  return commands
}

export function pickLayer(source, min = 11, max = 99999) {
  if (!source) {
    return min
  }

  let hash = 0

  for (let i = 0; i < source.length; i++) {
    const chr = source.charCodeAt(i)
    hash = (hash << 5) - hash + chr
    hash |= 0
  }

  hash = hash < 0 ? -hash : hash

  return min + (hash % (max - min + 1))
}
