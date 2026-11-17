import { textOffsetOf } from "../text-offsets.ts"
import { wordSpans, type Span } from "../segments.ts"
import type { Point } from "../../point.ts"

type TouchOptions = {
  knob: HTMLElement
  text: HTMLElement
  doubleTap(): void
  select(span: Span): boolean
  remove(point: Point): boolean
  overBox(point: Point): boolean
}

export function bindTouchControls({ knob, text, doubleTap, select, remove, overBox }: TouchOptions) {
  let touchInput = false
  document.addEventListener(
    "pointerdown",
    (event) => {
      touchInput = event.pointerType === "touch"
    },
    { capture: true },
  )
  document.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches[0]
      if (
        event.target instanceof Element &&
        (event.target.closest(".knob") || (touch && text.contains(event.target) && overBox({ x: touch.pageX, y: touch.pageY })))
      ) {
        event.preventDefault()
        getSelection()?.removeAllRanges()
      }
    },
    { passive: false, capture: true },
  )
  document.addEventListener("contextmenu", (event) => {
    if (touchInput && event.target instanceof Element && event.target.closest("#canvas, .knob")) event.preventDefault()
  })
  document.addEventListener("selectionchange", () => {
    const selection = getSelection()
    if (touchInput && selection?.anchorNode && (text.contains(selection.anchorNode) || knob.contains(selection.anchorNode))) selection.removeAllRanges()
  })
  let lastKnob = 0
  let lastBox = 0
  let press: { id: number; x: number; y: number; moved: boolean; box: boolean; knob: boolean } | undefined
  for (const element of [knob, text]) {
    element.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch") return
      if (element === knob || overBox({ x: event.pageX, y: event.pageY })) event.preventDefault()
      const point = { x: event.pageX, y: event.pageY }
      press = { id: event.pointerId, ...point, moved: false, box: overBox(point), knob: element === knob }
    })
    element.addEventListener("pointermove", (event) => {
      if (press?.id === event.pointerId && Math.hypot(event.pageX - press.x, event.pageY - press.y) > 12) press.moved = true
    })
    element.addEventListener("pointerup", (event) => {
      const held = press
      press = undefined
      if (!held || held.id !== event.pointerId || held.moved) return
      event.preventDefault()
      if (held.knob) {
        if (event.timeStamp - lastKnob < 400) {
          lastKnob = 0
          doubleTap()
        } else lastKnob = event.timeStamp
        return
      }
      if (held.box) {
        if (event.timeStamp - lastBox < 400) {
          lastBox = 0
          remove({ x: event.pageX, y: event.pageY })
        } else lastBox = event.timeStamp
        return
      }
      const position = document.caretPositionFromPoint(event.clientX, event.clientY)
      if (!position || !text.contains(position.offsetNode)) return
      const offset = textOffsetOf(text, position.offsetNode, position.offset)
      const span = wordSpans(text.textContent ?? "").find(({ start, end }) => start <= offset && end >= offset)
      if (span) select(span)
    })
    element.addEventListener("pointercancel", () => {
      press = undefined
    })
  }
}
