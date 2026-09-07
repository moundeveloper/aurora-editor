import type { EditorLayer, MediaAsset } from '@/models/editor'
import { mediaUrl } from '@/services/mediaLibrary'
import { buildAudioGraph, type AudioGraph } from './audioGraph'
import { sourceTime } from '@/engine/animation/timeRemap'

export function clipAudioWindow(layer: EditorLayer, time: number, bufferDuration: number) {
  const elapsed = Math.max(0, time - layer.start)
  const offset = Math.max(0, layer.sourceOffset ?? 0) + elapsed
  const duration = Math.min(layer.duration - elapsed, bufferDuration - offset)
  return duration > 0 ? { delay: Math.max(0, layer.start - time), offset, duration } : null
}

export function waveformPeaks(buffer: AudioBuffer, count = 160) {
  const peaks = Array<number>(count).fill(0)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel)
    for (let i = 0; i < samples.length; i++) {
      const bucket = Math.min(count - 1, Math.floor(i * count / samples.length))
      peaks[bucket] = Math.max(peaks[bucket]!, Math.abs(samples[i]!))
    }
  }
  return peaks
}

export function remapAudioBuffer(context: BaseAudioContext, buffer: AudioBuffer, layer: EditorLayer) {
  if (!layer.timeRemap) return buffer
  const output = context.createBuffer(buffer.numberOfChannels, Math.max(1, Math.ceil(layer.duration * buffer.sampleRate)), buffer.sampleRate)
  // Source positions are shared across channels to keep a stereo pair phase-aligned.
  const positions = Float64Array.from({ length: output.length }, (_, i) => sourceTime(layer, layer.start + i / output.sampleRate) * buffer.sampleRate)
  for (let channel = 0; channel < output.numberOfChannels; channel++) {
    const input = buffer.getChannelData(channel), data = output.getChannelData(channel)
    for (let i = 0; i < data.length; i++) {
      const position = positions[i]!, index = Math.floor(position), blend = position - index
      data[i] = index >= 0 && index < input.length ? input[index]! * (1 - blend) + (input[index + 1] ?? input[index]!) * blend : 0
    }
  }
  return output
}

/** Shared decoded buffers; live scheduling and offline mixing use the same graph and clip windows. */
export class AudioEngine {
  private context: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer>()
  private pendingBuffers = new Map<string, Promise<void>>()
  private sources: AudioBufferSourceNode[] = []
  private graph: ReturnType<typeof buildAudioGraph> | null = null
  private generation = 0
  private anchor: { context: number; project: number } | null = null
  private output: GainNode | null = null
  private muted = false
  private getContext() { return this.context ??= new AudioContext() }
  get time() { return this.anchor && this.context ? this.anchor.project + this.context.currentTime - this.anchor.context : null }
  setMuted(muted: boolean) { this.muted = muted; if (this.output) this.output.gain.value = muted ? 0 : 1 }

  async prepare(layers: EditorLayer[], assets: MediaAsset[]) {
    const context = this.getContext()
    const byId = new Map(assets.map(asset => [asset.id, asset]))
    await Promise.all(layers.filter(layer => layer.type === 'audio' && !layer.isPlaceholder).map(async layer => {
      const asset = byId.get(layer.assetId ?? '')
      if (!asset?.hash || this.buffers.has(asset.hash)) return
      const hash = asset.hash
      let pending = this.pendingBuffers.get(hash)
      if (!pending) {
        pending = (async () => {
          const response = await fetch(mediaUrl(hash))
          if (!response.ok) throw new Error(`Unable to load audio: ${asset.name}`)
          this.buffers.set(hash, await context.decodeAudioData(await response.arrayBuffer()))
        })().finally(() => this.pendingBuffers.delete(hash))
        this.pendingBuffers.set(hash, pending)
      }
      await pending
    }))
  }

  peaks(asset: MediaAsset | undefined) { const buffer = asset?.hash ? this.buffers.get(asset.hash) : undefined; return buffer ? waveformPeaks(buffer) : [] }
  amplitude(asset: MediaAsset | undefined, time: number) {
    const buffer = asset?.hash ? this.buffers.get(asset.hash) : undefined
    if (!buffer || time < 0 || time >= buffer.duration) return 0
    const from = Math.floor(time * buffer.sampleRate), end = Math.min(buffer.length, from + Math.ceil(buffer.sampleRate / 60))
    let sum = 0
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel)
      for (let i = from; i < end; i++) sum += data[i]! ** 2
    }
    return Math.sqrt(sum / Math.max(1, (end - from) * buffer.numberOfChannels))
  }

  private schedule(context: BaseAudioContext, graph: AudioGraph, layers: EditorLayer[], assets: MediaAsset[], time: number, destination: AudioNode) {
    const built = buildAudioGraph(context, graph, destination)
    const master = graph.nodes.find(node => node.kind === 'master')
    const byId = new Map(assets.map(asset => [asset.id, asset]))
    const scheduled: AudioBufferSourceNode[] = []
    const prepared: { buffer: AudioBuffer; targets: AudioNode[]; window: NonNullable<ReturnType<typeof clipAudioWindow>> }[] = []
    const solo = graph.nodes.some(node => node.kind === 'source' && node.solo && !node.mute)
    for (const layer of layers) {
      if (layer.type !== 'audio' || layer.muted || layer.isPlaceholder) continue
      const asset = byId.get(layer.assetId ?? '')
      const buffer = asset?.hash ? this.buffers.get(asset.hash) : undefined
      if (!buffer) continue
      const remapped = remapAudioBuffer(context, buffer, layer)
      const window = clipAudioWindow(layer.timeRemap ? { ...layer, sourceOffset: 0 } : layer, time, remapped.duration)
      if (!window) continue
      const routes = graph.nodes.filter(node => node.kind === 'source' && node.sourceId === layer.id)
      const targets = routes.length ? routes.map(node => built.ports.get(node.id)!.input)
        : !solo && master ? [built.ports.get(master.id)!.input] : []
      if (!targets.length) continue
      prepared.push({ buffer: remapped, targets, window })
    }
    // Remapping can be expensive. Set one shared clock origin after all buffers are ready.
    const startAt = context.currentTime
    for (const { buffer, targets, window } of prepared) {
      const source = context.createBufferSource()
      source.buffer = buffer
      targets.forEach(target => source.connect(target))
      source.start(startAt + window.delay, window.offset, window.duration)
      scheduled.push(source)
    }
    return { built, scheduled, startAt }
  }

  async play(graph: AudioGraph, layers: EditorLayer[], assets: MediaAsset[], time: number) {
    this.stop()
    const generation = this.generation
    const context = this.getContext()
    await context.resume()
    await this.prepare(layers, assets)
    if (generation !== this.generation) return false
    this.output ??= context.createGain()
    this.output.disconnect(); this.output.connect(context.destination)
    this.output.gain.value = this.muted ? 0 : 1
    const { built, scheduled, startAt } = this.schedule(context, graph, layers, assets, time, this.output)
    this.anchor = { context: startAt, project: time }
    this.graph = built; this.sources = scheduled
    return true
  }

  stop() {
    this.generation++
    this.anchor = null
    this.sources.forEach(source => { try { source.stop() } catch { /* Already ended. */ } source.disconnect() })
    this.sources = []; this.graph?.dispose(); this.graph = null
  }

  async mix(graph: AudioGraph, layers: EditorLayer[], assets: MediaAsset[], duration: number) {
    await this.prepare(layers, assets)
    const context = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * 48000)), 48000)
    const { built } = this.schedule(context, graph, layers, assets, 0, context.destination)
    try { return await context.startRendering() } finally { built.dispose() }
  }
}

export function audioWav(buffer: AudioBuffer) {
  const channels = buffer.numberOfChannels, length = buffer.length * channels * 2
  const data = new ArrayBuffer(44 + length), view = new DataView(data)
  const text = (at: number, value: string) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 36 + length, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, length, true)
  for (let i = 0; i < buffer.length; i++) for (let channel = 0; channel < channels; channel++) {
    const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]!))
    view.setInt16(44 + (i * channels + channel) * 2, sample * (sample < 0 ? 32768 : 32767), true)
  }
  return new Blob([data], { type: 'audio/wav' })
}

export const sharedAudioEngine = new AudioEngine()
