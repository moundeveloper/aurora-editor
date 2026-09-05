/**
 * A minimal WebM (Matroska) writer, enough to wrap encoded video into a playable file.
 *
 * WebCodecs hands back encoded chunks with exact timestamps but no container, and the browser
 * exposes no muxer. MediaRecorder does mux, but it timestamps frames by when they arrive, so an
 * offline export that renders slower or faster than real time comes out with the wrong duration.
 * Writing the container here is what keeps a twelve-second export twelve seconds long.
 *
 * Only the elements a player needs are emitted: a header, one video track, and clusters of frames.
 * There is no Cues index, so seeking is approximate; playback, duration, and size are exact.
 */

const EBML = {
  header: 0x1a45dfa3,
  version: 0x4286,
  readVersion: 0x42f7,
  maxIdLength: 0x42f2,
  maxSizeLength: 0x42f3,
  docType: 0x4282,
  docTypeVersion: 0x4287,
  docTypeReadVersion: 0x4285,
  segment: 0x18538067,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  muxingApp: 0x4d80,
  writingApp: 0x5741,
  duration: 0x4489,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackUid: 0x73c5,
  trackType: 0x83,
  flagLacing: 0x9c,
  language: 0x22b59c,
  codecId: 0x86,
  defaultDuration: 0x23e383,
  video: 0xe0,
  pixelWidth: 0xb0,
  pixelHeight: 0xba,
  cluster: 0x1f43b675,
  timecode: 0xe7,
  simpleBlock: 0xa3,
} as const

/** Matroska measures every timestamp in TimecodeScale units. One millisecond keeps the maths plain. */
const TIMECODE_SCALE_NS = 1_000_000
const MICROS_PER_MILLISECOND = 1000

/** A relative block timecode is a signed 16-bit value, so a cluster cannot span more than this. */
const MAX_CLUSTER_SPAN_MS = 30_000

function idBytes(id: number): number[] {
  const bytes: number[] = []
  let remaining = id
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff)
    remaining = Math.floor(remaining / 256)
  }
  return bytes.length ? bytes : [0]
}

/**
 * Encodes a length as an EBML variable-size integer.
 *
 * The first byte carries a leading marker bit whose position states the total width, so the value
 * itself only has 7 bits per byte to work with — hence the `2^(7 * width) - 1` ceiling per width.
 */
function sizeBytes(size: number): number[] {
  for (let width = 1; width <= 8; width += 1) {
    const capacity = 2 ** (7 * width) - 1
    if (size >= capacity) continue
    const bytes: number[] = []
    let remaining = size
    for (let index = width - 1; index >= 0; index -= 1) {
      bytes[index] = remaining & 0xff
      remaining = Math.floor(remaining / 256)
    }
    bytes[0]! |= 1 << (8 - width)
    return bytes
  }
  throw new Error(`Element of ${size} bytes is too large for a WebM size field`)
}

function uintBytes(value: number): number[] {
  const bytes: number[] = []
  let remaining = Math.max(0, Math.round(value))
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff)
    remaining = Math.floor(remaining / 256)
  }
  return bytes.length ? bytes : [0]
}

function floatBytes(value: number): number[] {
  const buffer = new ArrayBuffer(8)
  new DataView(buffer).setFloat64(0, value, false)
  return [...new Uint8Array(buffer)]
}

type Payload = number[] | Uint8Array

function element(id: number, payload: Payload): number[] {
  const body = payload instanceof Uint8Array ? payload : Uint8Array.from(payload)
  return [...idBytes(id), ...sizeBytes(body.length), ...body]
}

function container(id: number, children: number[][]): number[] {
  return element(id, children.flat())
}

export interface WebMTrack {
  width: number
  height: number
  /** Matroska codec id, for example `V_VP9` or `V_AV1`. */
  codecId: string
  frameRate: number
}

export interface WebMFrame {
  data: Uint8Array
  /** Presentation time in microseconds, as WebCodecs reports it. */
  timestamp: number
  keyFrame: boolean
}

/** Which Matroska codec id carries a given WebCodecs codec string. */
export function matroskaCodecId(codec: string): string {
  if (codec.startsWith('vp09') || codec === 'vp9') return 'V_VP9'
  if (codec.startsWith('vp08') || codec === 'vp8') return 'V_VP8'
  if (codec.startsWith('av01')) return 'V_AV1'
  throw new Error(`No WebM codec mapping for ${codec}. WebM carries VP8, VP9, and AV1.`)
}

/**
 * Wraps encoded frames into a WebM byte stream.
 *
 * Frames must arrive in presentation order. A new cluster starts at every key frame, which keeps
 * every relative block timecode small and gives a player somewhere to resume from.
 */
export function writeWebM(track: WebMTrack, frames: readonly WebMFrame[]): Uint8Array {
  if (!frames.length) throw new Error('A WebM file needs at least one frame')
  const header = container(EBML.header, [
    element(EBML.version, uintBytes(1)),
    element(EBML.readVersion, uintBytes(1)),
    element(EBML.maxIdLength, uintBytes(4)),
    element(EBML.maxSizeLength, uintBytes(8)),
    element(EBML.docType, [...new TextEncoder().encode('webm')]),
    element(EBML.docTypeVersion, uintBytes(2)),
    element(EBML.docTypeReadVersion, uintBytes(2)),
  ])

  const lastTimestamp = frames[frames.length - 1]!.timestamp
  const frameDurationMs = 1000 / Math.max(1, track.frameRate)
  const durationMs = lastTimestamp / MICROS_PER_MILLISECOND + frameDurationMs
  const info = container(EBML.info, [
    element(EBML.timecodeScale, uintBytes(TIMECODE_SCALE_NS)),
    element(EBML.muxingApp, [...new TextEncoder().encode('Aurora Editor')]),
    element(EBML.writingApp, [...new TextEncoder().encode('Aurora Editor')]),
    element(EBML.duration, floatBytes(durationMs)),
  ])

  const tracks = container(EBML.tracks, [
    container(EBML.trackEntry, [
      element(EBML.trackNumber, uintBytes(1)),
      element(EBML.trackUid, uintBytes(1)),
      element(EBML.trackType, uintBytes(1)),
      element(EBML.flagLacing, uintBytes(0)),
      element(EBML.language, [...new TextEncoder().encode('und')]),
      element(EBML.codecId, [...new TextEncoder().encode(track.codecId)]),
      element(EBML.defaultDuration, uintBytes(Math.round(TIMECODE_SCALE_NS * frameDurationMs))),
      container(EBML.video, [
        element(EBML.pixelWidth, uintBytes(track.width)),
        element(EBML.pixelHeight, uintBytes(track.height)),
      ]),
    ]),
  ])

  const clusters: number[][] = []
  let blocks: number[][] = []
  let clusterTimeMs = 0

  const flushCluster = () => {
    if (!blocks.length) return
    clusters.push(container(EBML.cluster, [element(EBML.timecode, uintBytes(clusterTimeMs)), ...blocks]))
    blocks = []
  }

  frames.forEach((frame) => {
    const timeMs = Math.round(frame.timestamp / MICROS_PER_MILLISECOND)
    if (!blocks.length || (frame.keyFrame && blocks.length) || timeMs - clusterTimeMs > MAX_CLUSTER_SPAN_MS) {
      flushCluster()
      clusterTimeMs = timeMs
    }
    const relative = timeMs - clusterTimeMs
    const payload = new Uint8Array(4 + frame.data.length)
    // Track number one, written as a single-byte variable-size integer.
    payload[0] = 0x81
    payload[1] = (relative >> 8) & 0xff
    payload[2] = relative & 0xff
    payload[3] = frame.keyFrame ? 0x80 : 0x00
    payload.set(frame.data, 4)
    blocks.push(element(EBML.simpleBlock, payload))
  })
  flushCluster()

  const segment = container(EBML.segment, [info, tracks, ...clusters])
  return Uint8Array.from([...header, ...segment])
}
