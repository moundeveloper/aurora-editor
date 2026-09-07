import { describe, expect, it } from 'vitest'
import { clipAudioWindow, waveformPeaks, audioWav } from '../AudioEngine'
import { defaultAudioGraph, safeAudioConnections } from '../audioGraph'
import type { EditorLayer } from '@/models/editor'

describe('audio scheduling and serialization', () => {
  it('honors timeline start, scrubbing, source trim and decoded duration', () => {
    const layer = { start: 3, duration: 5, sourceOffset: 2 } as EditorLayer
    expect(clipAudioWindow(layer, 0, 20)).toEqual({ delay: 3, offset: 2, duration: 5 })
    expect(clipAudioWindow(layer, 5, 6)).toEqual({ delay: 0, offset: 4, duration: 2 })
    expect(clipAudioWindow(layer, 8, 20)).toBeNull()
  })
  it('rejects cyclic, duplicate and dangling graph edges', () => {
    const graph = defaultAudioGraph()
    graph.nodes.push({ ...graph.nodes[0]!, id: 'source', kind: 'source' })
    graph.connections = [{ id: 'a', from: 'source', to: 'audio-master' }, { id: 'b', from: 'audio-master', to: 'source' }, { id: 'c', from: 'source', to: 'audio-master' }, { id: 'd', from: 'missing', to: 'audio-master' }]
    expect(safeAudioConnections(graph).map(edge => edge.id)).toEqual(['a'])
  })
  it('writes stereo PCM and derives waveform peaks from actual samples', async () => {
    const samples = [Float32Array.of(0, -.5, 1, 0), Float32Array.of(.25, 0, -.25, 0)]
    const buffer = { numberOfChannels: 2, length: 4, sampleRate: 48000, getChannelData: (channel: number) => samples[channel]! } as AudioBuffer
    expect(waveformPeaks(buffer, 2)).toEqual([.5, 1])
    const view = new DataView(await audioWav(buffer).arrayBuffer())
    expect(view.byteLength).toBe(60)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getInt16(48, true)).toBe(-16384)
  })
})
