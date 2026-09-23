/** One requestAnimationFrame queue for editor render surfaces. Hidden documents defer work. */
const jobs = new Map<number, () => void>()
let sequence = 0, frame = 0
function wake() {
  if (frame || !jobs.size || document.hidden) return
  frame = requestAnimationFrame(() => {
    frame = 0
    const pending = [...jobs]
    jobs.clear()
    for (const [, render] of pending) {
      try { render() } catch (error) { console.error('Aurora surface render failed', error) }
    }
    wake()
  })
}
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake)
export function scheduleSurface(render: () => void) {
  const id = ++sequence
  jobs.set(id, render); wake()
  return id
}
export function cancelSurface(id: number) {
  jobs.delete(id)
  if (!jobs.size && frame) { cancelAnimationFrame(frame); frame = 0 }
}
