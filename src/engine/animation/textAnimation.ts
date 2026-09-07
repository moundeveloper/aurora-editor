import type { TextAnimator } from '@/models/editor'
import type { ShapePoint } from '@/engine/shapes/shapeGeometry'
import { evaluateNumericProperty } from './evaluateProperty'
export function textUnits(text: string, unit: TextAnimator['unit']) {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(item => item.segment)
  let word = -1, inWord = false
  return graphemes.map((text, index) => {
    const whitespace = /^\s+$/u.test(text)
    if (!whitespace && !inWord) word++
    inWord = !whitespace
    return { text, index: unit === 'character' ? index : Math.max(0, word) }
  })
}
export function layoutTextLines(glyphs:string[],widths:number[],spacing:number,lineHeight:number) {
  const lines:number[][]=[[]]
  glyphs.forEach((glyph,index)=>{if(glyph==='\n' || glyph==='\r\n')lines.push([]);else lines.at(-1)!.push(index)})
  const layout=Array.from({length:glyphs.length},()=>({x:0,y:0}))
  lines.forEach((indices,line)=>{
    const width=indices.reduce((sum,index)=>sum+widths[index]!,0)+Math.max(0,indices.length-1)*spacing
    let cursor=-width/2
    for(const index of indices){layout[index]={x:cursor+widths[index]!/2,y:(line-(lines.length-1)/2)*lineHeight};cursor+=widths[index]!+spacing}
  })
  return layout
}
export function textAnimatorWeight(animator: TextAnimator, index: number, count: number, time: number) {
  if (!animator.enabled) return 0
  const at = (key: keyof TextAnimator['parameters']) => evaluateNumericProperty(animator.parameters[key], time)
  const start = at('start') / 100 * count, end = at('end') / 100 * count
  if (index < start || index >= end) return 0
  const stagger = Math.max(0, at('stagger'))
  return 1 - Math.max(0, Math.min(1, at('progress') * (1 + stagger * Math.max(0, end - start - 1)) - (index - start) * stagger))
}
export function pointAlongOutline(points: ShapePoint[], closed: boolean, distance: number) {
  const vertices = closed && points.length ? [...points, points[0]!] : points
  const lengths = vertices.slice(1).map((point, i) => Math.hypot(point[0] - vertices[i]![0], point[1] - vertices[i]![1]))
  const total = lengths.reduce((a, b) => a + b, 0)
  let remaining = closed && total ? ((distance % total) + total) % total : Math.max(0, Math.min(total, distance))
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!
    if (remaining > length && i < lengths.length - 1) { remaining -= length; continue }
    const a = vertices[i]!, b = vertices[i + 1]!, progress = length ? remaining / length : 0
    return { x: a[0] + (b[0] - a[0]) * progress, y: a[1] + (b[1] - a[1]) * progress, rotation: Math.atan2(b[1] - a[1], b[0] - a[0]) }
  }
  return { x: points[0]?.[0] ?? 0, y: points[0]?.[1] ?? 0, rotation: 0 }
}
