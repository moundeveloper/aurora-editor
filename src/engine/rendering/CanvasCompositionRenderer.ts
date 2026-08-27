import type { EditorLayer } from '@/models/editor'
import { evaluateNumericProperty } from '@/engine/animation/evaluateProperty'

export interface CanvasRenderOptions {
  time: number
  layers: EditorLayer[]
  selectedLayerId: string
  width: number
  height: number
}

export class CanvasCompositionRenderer {
  private context: CanvasRenderingContext2D | null = null
  private source = new Image()
  private ready = false

  constructor(private canvas: HTMLCanvasElement, sourceUrl: string) {
    this.context = canvas.getContext('2d', { alpha: false })
    this.source.onload = () => { this.ready = true }
    this.source.src = sourceUrl
  }

  render(options: CanvasRenderOptions) {
    const ctx = this.context
    if (!ctx) return
    const { width, height } = this.canvas
    ctx.fillStyle = '#080a10'
    ctx.fillRect(0, 0, width, height)

    const isActive = (layer: EditorLayer) => options.time >= layer.start && options.time < layer.start + layer.duration
    const scaleX = width / options.width
    const scaleY = height / options.height

    const renderLayer = (layer: EditorLayer) => {
      if (!layer.visible || layer.type === 'audio' || !isActive(layer)) return
      if (layer.type === 'cluster') {
        ctx.save()
        ctx.translate(evaluateNumericProperty(layer.transform.x, options.time) * scaleX, evaluateNumericProperty(layer.transform.y, options.time) * scaleY)
        ctx.rotate((evaluateNumericProperty(layer.transform.rotation, options.time) * Math.PI) / 180)
        ctx.scale(evaluateNumericProperty(layer.transform.scaleX, options.time) / 100, evaluateNumericProperty(layer.transform.scaleY, options.time) / 100)
        ctx.translate(-width / 2, -height / 2)
        ctx.globalAlpha *= evaluateNumericProperty(layer.transform.opacity, options.time) / 100
        ;[...(layer.children ?? [])].reverse().forEach(renderLayer)
        ctx.restore()
        return
      }
      if (layer.type === 'video') {
        if (!this.ready) return
        const imageRatio = this.source.width / this.source.height
        const canvasRatio = width / height
        const drawWidth = imageRatio > canvasRatio ? height * imageRatio : width
        const drawHeight = imageRatio > canvasRatio ? height : width / imageRatio
        ctx.save()
        ctx.translate(evaluateNumericProperty(layer.transform.x, options.time) * scaleX, evaluateNumericProperty(layer.transform.y, options.time) * scaleY)
        ctx.rotate((evaluateNumericProperty(layer.transform.rotation, options.time) * Math.PI) / 180)
        ctx.scale(evaluateNumericProperty(layer.transform.scaleX, options.time) / 100, evaluateNumericProperty(layer.transform.scaleY, options.time) / 100)
        ctx.globalAlpha *= evaluateNumericProperty(layer.transform.opacity, options.time) / 100
        ctx.drawImage(this.source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
        ctx.restore()
        return
      }
      if (layer.type === 'adjustment') {
        const vignette = ctx.createRadialGradient(width / 2, height / 2, height * .25, width / 2, height / 2, width * .68)
        vignette.addColorStop(0, 'rgba(3, 7, 15, 0)')
        vignette.addColorStop(1, 'rgba(2, 4, 11, .5)')
        ctx.fillStyle = vignette
        ctx.fillRect(0, 0, width, height)
        return
      }

      ctx.save()
      ctx.translate(evaluateNumericProperty(layer.transform.x, options.time) * scaleX, evaluateNumericProperty(layer.transform.y, options.time) * scaleY)
      ctx.rotate((evaluateNumericProperty(layer.transform.rotation, options.time) * Math.PI) / 180)
      ctx.scale(evaluateNumericProperty(layer.transform.scaleX, options.time) / 100, evaluateNumericProperty(layer.transform.scaleY, options.time) / 100)
      ctx.globalAlpha *= evaluateNumericProperty(layer.transform.opacity, options.time) / 100

      if (layer.type === 'text') {
        const scale = width / options.width
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#f3eee6'
        ctx.font = `600 ${Math.max(18, 42 * scale)}px Inter, system-ui, sans-serif`
        ctx.letterSpacing = `${Math.max(1, 4 * scale)}px`
        ctx.shadowColor = 'rgba(118, 132, 220, .6)'
        ctx.shadowBlur = 16
        ctx.fillText(layer.textContent ?? layer.name, 0, 0)
      } else if (layer.type === 'shape') {
        const shapeWidth = 280 * scaleX
        const shapeHeight = 180 * scaleY
        ctx.fillStyle = layer.color
        ctx.strokeStyle = 'rgba(226, 231, 255, .78)'
        ctx.lineWidth = 2
        ctx.beginPath()
        if (layer.shapeKind === 'ellipse') ctx.ellipse(0, 0, shapeWidth / 2, shapeHeight / 2, 0, 0, Math.PI * 2)
        else ctx.roundRect(-shapeWidth / 2, -shapeHeight / 2, shapeWidth, shapeHeight, 12)
        ctx.fill()
        ctx.stroke()
      } else if (layer.type === 'image' && this.ready) {
        const imageSize = 260 * Math.min(scaleX, scaleY)
        ctx.drawImage(this.source, -imageSize / 2, -imageSize / 2, imageSize, imageSize)
      }
      ctx.restore()
    }

    ;[...options.layers].reverse().forEach(renderLayer)
  }

}
