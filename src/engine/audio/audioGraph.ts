import type { AudioGraph, AudioConnection } from '@/models/editor'
export type { AudioNodeKind, AudioGraphNode, AudioConnection, AudioGraph } from '@/models/editor'
export function defaultAudioGraph(): AudioGraph {
  return { nodes: [{ id: 'audio-master', kind: 'master', title: 'Master Output', x: 790, y: 120, bypassed: false, gain: 0, pan: 0, mute: false, solo: false, limiter: true }], connections: [] }
}

/** Reject feedback edges: imported graphs must not create unbounded feedback in Web Audio. */
export function safeAudioConnections(graph: AudioGraph): AudioConnection[] {
  const accepted: AudioConnection[] = []
  const ids = new Set(graph.nodes.map(node => node.id))
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (from === to) return true
    if (seen.has(from)) return false
    seen.add(from)
    return accepted.some(edge => edge.from === from && reaches(edge.to, to, seen))
  }
  for (const edge of graph.connections) {
    if (!ids.has(edge.from) || !ids.has(edge.to) || reaches(edge.to, edge.from)) continue
    if (!accepted.some(item => item.from === edge.from && item.to === edge.to)) accepted.push(edge)
  }
  return accepted
}

export const dbGain = (db: number) => Math.pow(10, Math.max(-96, Math.min(24, Number.isFinite(db) ? db : 0)) / 20)

/** Deterministic stereo impulse shared by live and offline room reverbs. */
function impulse(context: BaseAudioContext, room: number) {
  const seconds = .1 + Math.max(0, Math.min(100, room)) / 100 * 2.9
  const buffer = context.createBuffer(2, Math.ceil(context.sampleRate * seconds), context.sampleRate)
  let seed = 12345
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0
      data[i] = ((seed >>> 0) / 2147483648 - 1) * Math.pow(1 - i / data.length, 3)
    }
  }
  return buffer
}

export function buildAudioGraph(context: BaseAudioContext, graph: AudioGraph, destination: AudioNode) {
  const resources: AudioNode[] = []
  const own = <T extends AudioNode>(node: T) => { resources.push(node); return node }
  const ports = new Map<string, { input: AudioNode; output: AudioNode }>()
  const solo = graph.nodes.some(node => node.kind === 'source' && node.solo && !node.mute)
  for (const node of graph.nodes) {
    const input = own(context.createGain())
    let output: AudioNode = input
    const append = (next: AudioNode) => { output.connect(next); output = next }
    if (!node.bypassed) {
      if (node.kind === 'eq') {
        for (const [type, frequency, gain] of [['lowshelf', 200, node.low], ['peaking', 1000, node.mid], ['highshelf', 5000, node.high]] as const) {
          const filter = own(context.createBiquadFilter())
          filter.type = type; filter.frequency.value = frequency; filter.gain.value = gain ?? 0
          append(filter)
        }
      }
      if (node.kind === 'compressor' || node.kind === 'master' && node.limiter) {
        const compressor = own(context.createDynamicsCompressor())
        compressor.threshold.value = node.kind === 'master' ? -1 : node.threshold ?? -18
        compressor.ratio.value = node.kind === 'master' ? 20 : node.ratio ?? 4
        compressor.attack.value = (node.attack ?? 3) / 1000
        compressor.release.value = (node.release ?? 180) / 1000
        append(compressor)
      }
      if (node.kind === 'reverb') {
        const convolver = own(context.createConvolver())
        convolver.buffer = impulse(context, node.room ?? 45)
        const wet = own(context.createGain()), dry = own(context.createGain()), sum = own(context.createGain())
        wet.gain.value = Math.max(0, Math.min(1, (node.mix ?? 20) / 100)); dry.gain.value = 1 - wet.gain.value
        output.connect(dry); dry.connect(sum); output.connect(convolver); convolver.connect(wet); wet.connect(sum); output = sum
      }
      const gain = own(context.createGain())
      gain.gain.value = dbGain(node.gain)
      append(gain)
      const pan = own(context.createStereoPanner())
      pan.pan.value = Math.max(-1, Math.min(1, node.pan / 100))
      append(pan)
    }
    input.gain.value = node.mute || node.kind === 'source' && solo && !node.solo ? 0 : 1
    ports.set(node.id, { input, output })
    if (node.kind === 'master') output.connect(destination)
  }
  for (const edge of safeAudioConnections(graph)) ports.get(edge.from)!.output.connect(ports.get(edge.to)!.input)
  return { ports, dispose: () => resources.forEach(node => node.disconnect()) }
}
