import { describe, expect, it } from 'vitest'
import { scopeDensity } from '../scopes'
describe('display-referred scopes', () => {
  const frame = { width: 2, height: 1, data: new Uint8ClampedArray([0,0,0,255,255,255,255,255]) }
  it('places black and white at the waveform endpoints', () => {
    const bins = scopeDensity(frame, 'waveform', 10, 10)
    expect(bins[(9 * 10) * 3 + 1]).toBe(1)
    expect(bins[9 * 3 + 1]).toBe(1)
    expect(bins.reduce((a,b) => a+b,0)).toBe(2)
  })
  it('separates RGB parade channels and centers neutral vectors', () => {
    const parade = scopeDensity(frame, 'parade', 10, 10)
    expect(parade.reduce((a,b) => a+b,0)).toBe(6)
    const vectors = scopeDensity(frame, 'vectorscope', 11, 11)
    expect(vectors[(5 * 11 + 5) * 3 + 1]).toBe(2)
  })
  it('omits fully transparent pixels', () => {
    expect(scopeDensity({width:1,height:1,data:new Uint8ClampedArray([255,0,0,0])}, 'waveform').some(Boolean)).toBe(false)
  })
})
