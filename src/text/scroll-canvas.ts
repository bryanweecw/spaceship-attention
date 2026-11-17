import type { Point } from "../point.ts"
import type { Caret } from "./caret.ts"

export function createScrollableCanvas(canvas: HTMLElement, knob: HTMLElement, scrub: (point: Point) => void) {
  let extent = innerHeight * 2
  let pointer: { id: number; x: number; y: number } | undefined
  let origin = { x: 0, y: 0 }
  let moved = false
  let frame: number | undefined
  let previous = 0
  knob.addEventListener("pointerdown", (event) => {
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
    origin = { x: event.clientX, y: event.clientY }
    previous = 0
    moved = false
    frame ??= requestAnimationFrame(scrollAtEdge)
  })
  knob.addEventListener("pointermove", (event) => {
    if (pointer?.id === event.pointerId) {
      moved ||= Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
    }
  })
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) knob.addEventListener(type, stop)
  return {
    update(caret: Caret, lines: number, lineHeight: number, padding: number) {
      extent = Math.max(extent, innerHeight * 2, padding + Math.max(lines, caret.line + 1) * lineHeight + innerHeight)
      canvas.style.minHeight = `${Math.ceil(extent)}px`
    },
  }

  function stop() {
    pointer = undefined
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    previous = 0
  }

  function scrollAtEdge(now: number) {
    frame = undefined
    if (!pointer || !knob.hasPointerCapture(pointer.id)) return stop()
    const elapsed = previous ? Math.min(50, now - previous) : 0
    previous = now
    const bottom = innerHeight - 48
    const velocity = pointer.y > bottom - 64 ? Math.min(1, (pointer.y - bottom + 64) / 64) : pointer.y < 64 ? -Math.min(1, (64 - pointer.y) / 64) : 0
    const before = scrollY
    scrollBy(0, moved ? velocity * elapsed * 0.6 : 0)
    if (scrollY !== before) scrub({ x: pointer.x + scrollX, y: pointer.y + scrollY })
    frame = requestAnimationFrame(scrollAtEdge)
  }
}
