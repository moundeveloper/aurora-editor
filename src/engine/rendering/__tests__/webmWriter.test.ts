import { describe, expect, it } from 'vitest'
import { matroskaCodecId, writeWebM, type WebMFrame } from '@/engine/rendering/webmWriter'

/**
 * A throwaway EBML reader, so the writer is checked against a parse of its own output rather than
 * against a byte snapshot that would tell us nothing about whether the structure is valid.
 */
interface Node { id: number; start: number; end: number; children?: Node[] }

const MASTERS = new Set([0x1a45dfa3, 0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0, 0x1f43b675])

function readId(bytes: Uint8Array, offset: number) {
  const first = bytes[offset]!
  let width = 1
  for (let bit = 7; bit >= 0; bit -= 1) {
    if (first & (1 << bit)) break
    width += 1
  }
  if (width > 4) throw new Error(`Element id at ${offset} claims ${width} bytes`)
  let id = 0
  for (let index = 0; index < width; index += 1) id = id * 256 + bytes[offset + index]!
  return { id, next: offset + width }
}

function readSize(bytes: Uint8Array, offset: number) {
  const first = bytes[offset]!
  let width = 1
  for (let bit = 7; bit >= 0; bit -= 1) {
    if (first & (1 << bit)) break
    width += 1
  }
  if (width > 8) throw new Error(`Size at ${offset} claims ${width} bytes`)
  let size = first & ((1 << (8 - width)) - 1)
  for (let index = 1; index < width; index += 1) size = size * 256 + bytes[offset + index]!
  return { size, next: offset + width }
}

function parse(bytes: Uint8Array, start = 0, end = bytes.length): Node[] {
  const nodes: Node[] = []
  let offset = start
  while (offset < end) {
    const { id, next } = readId(bytes, offset)
    const { size, next: bodyStart } = readSize(bytes, next)
    const bodyEnd = bodyStart + size
    if (bodyEnd > end) throw new Error(`Element ${id.toString(16)} overruns its parent`)
    nodes.push({
      id,
      start: bodyStart,
      end: bodyEnd,
      ...(MASTERS.has(id) ? { children: parse(bytes, bodyStart, bodyEnd) } : {}),
    })
    offset = bodyEnd
  }
  return nodes
}

function find(nodes: Node[], ...path: number[]): Node | undefined {
  let current: Node | undefined
  let level = nodes
  for (const id of path) {
    current = level.find((node) => node.id === id)
    if (!current) return undefined
    level = current.children ?? []
  }
  return current
}

function uint(bytes: Uint8Array, node: Node) {
  let value = 0
  for (let index = node.start; index < node.end; index += 1) value = value * 256 + bytes[index]!
  return value
}

function frames(count: number, frameRate: number, keyEvery = 4): WebMFrame[] {
  return Array.from({ length: count }, (_, index) => ({
    data: Uint8Array.from([index, 1, 2, 3, 4, 5, 6, 7]),
    timestamp: Math.round((index * 1_000_000) / frameRate),
    keyFrame: index % keyEvery === 0,
  }))
}

const TRACK = { width: 1280, height: 720, codecId: 'V_VP9', frameRate: 30 }

describe('WebM writer', () => {
  it('maps WebCodecs codecs onto the ones WebM can carry', () => {
    expect(matroskaCodecId('vp09.00.10.08')).toBe('V_VP9')
    expect(matroskaCodecId('vp8')).toBe('V_VP8')
    expect(matroskaCodecId('av01.0.04M.08')).toBe('V_AV1')
    // H.264 encodes happily in WebCodecs but has no place in this container.
    expect(() => matroskaCodecId('avc1.640028')).toThrow(/VP8, VP9, and AV1/)
  })

  it('writes a file whose every element size is self-consistent', () => {
    const bytes = writeWebM(TRACK, frames(12, 30))
    // The parse itself is the assertion: it throws if any element overruns its parent.
    const top = parse(bytes)

    expect(top.map((node) => node.id)).toEqual([0x1a45dfa3, 0x18538067])
    expect(find(top, 0x1a45dfa3)).toBeDefined()
    expect(find(top, 0x18538067, 0x1549a966)).toBeDefined()
    expect(find(top, 0x18538067, 0x1654ae6b)).toBeDefined()
  })

  it('declares the doctype a player looks for', () => {
    const bytes = writeWebM(TRACK, frames(4, 30))
    const header = find(parse(bytes), 0x1a45dfa3)!
    const docType = header.children!.find((node) => node.id === 0x4282)!

    expect(new TextDecoder().decode(bytes.slice(docType.start, docType.end))).toBe('webm')
  })

  it('carries the track geometry and codec through to the Tracks element', () => {
    const bytes = writeWebM({ ...TRACK, width: 1920, height: 1080, codecId: 'V_AV1' }, frames(4, 24))
    const top = parse(bytes)
    const entry = find(top, 0x18538067, 0x1654ae6b, 0xae)!
    const codec = entry.children!.find((node) => node.id === 0x86)!
    const video = find(entry.children!, 0xe0)!

    expect(new TextDecoder().decode(bytes.slice(codec.start, codec.end))).toBe('V_AV1')
    expect(uint(bytes, video.children!.find((node) => node.id === 0xb0)!)).toBe(1920)
    expect(uint(bytes, video.children!.find((node) => node.id === 0xba)!)).toBe(1080)
    expect(uint(bytes, entry.children!.find((node) => node.id === 0xd7)!)).toBe(1)
  })

  it('states a duration that covers the last frame, not just its start', () => {
    const bytes = writeWebM(TRACK, frames(30, 30))
    const info = find(parse(bytes), 0x18538067, 0x1549a966)!
    const duration = info.children!.find((node) => node.id === 0x4489)!
    const view = new DataView(bytes.buffer, bytes.byteOffset + duration.start, duration.end - duration.start)

    // Thirty frames at 30fps is one second: 29 frame starts plus the last frame's own length.
    expect(view.getFloat64(0, false)).toBeCloseTo(1000, 1)
    expect(uint(bytes, info.children!.find((node) => node.id === 0x2ad7b1)!)).toBe(1_000_000)
  })

  it('opens a new cluster at every key frame and keeps block times relative to it', () => {
    const bytes = writeWebM(TRACK, frames(12, 30, 4))
    const segment = find(parse(bytes), 0x18538067)!
    const clusters = segment.children!.filter((node) => node.id === 0x1f43b675)

    // Key frames at 0, 4, and 8 of twelve frames.
    expect(clusters).toHaveLength(3)
    clusters.forEach((cluster) => {
      const blocks = cluster.children!.filter((node) => node.id === 0xa3)
      expect(blocks).toHaveLength(4)
      const clusterTime = uint(bytes, cluster.children!.find((node) => node.id === 0xe7)!)
      blocks.forEach((block, index) => {
        expect(bytes[block.start]).toBe(0x81)
        const relative = (bytes[block.start + 1]! << 8) | bytes[block.start + 2]!
        // Matroska stores whole milliseconds, so a 30fps frame time is rounded before the cluster
        // offset comes off it. The sum has to land back on the frame's own absolute millisecond.
        const frameIndex = clusters.indexOf(cluster) * 4 + index
        expect(clusterTime + relative).toBe(Math.round((frameIndex * 1000) / 30))
        expect(bytes[block.start + 3]).toBe(index === 0 ? 0x80 : 0x00)
      })
    })
  })

  it('keeps the encoded payload byte for byte', () => {
    const source = frames(3, 30, 1)
    const bytes = writeWebM(TRACK, source)
    const cluster = find(parse(bytes), 0x18538067)!.children!.find((node) => node.id === 0x1f43b675)!
    const block = cluster.children!.find((node) => node.id === 0xa3)!

    expect([...bytes.slice(block.start + 4, block.end)]).toEqual([...source[0]!.data])
  })

  it('refuses to write a file with no frames at all', () => {
    expect(() => writeWebM(TRACK, [])).toThrow(/at least one frame/)
  })
})
