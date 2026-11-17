import { circleOf, distance } from "./links.ts"

const STILL_TOLERANCE_PX = 4
/** Keeps a slow click from flashing the start of the sweep. */
const SWEEP_DELAY_MS = 100
/** A second press counts as part of a double press only this close to the first. */
const DOUBLE_PRESS_PX = 8

type HoldOptions = {
  /** The sweep starts filling. */
  onSweep?: () => void
  /** A started sweep ends: `completed` before `onHold` is called, or cancelled. */
  onSweepEnd?: (completed: boolean) => void
  /** If set, only the second press of a double press can hold: one starting within this many ms of the previous press, near the same spot. */
  secondPressWithin?: number
}

/**
 * Calls `onHold` with the latest pointer event once a press on `element` stays still for `SWEEP_DELAY_MS` plus `ms`, sweeping `--fill` on `element` from 0 to 1 over the `ms`, with `data-holding` set while it sweeps.
 * Moving more than `STILL_TOLERANCE_PX` before the sweep, or leaving the element's circle during it, or releasing cancels the hold; a cancelled press can't hold again.
 * Holding never blocks other handling of the press, such as a drag: moving away simply cancels it.
 */
export function onPressAndHold(
  element: HTMLElement,
  ms: number,
  onHold: (press: PointerEvent) => void,
  { onSweep, onSweepEnd, secondPressWithin }: HoldOptions = {},
) {
  let press: { start: PointerEvent; latest: PointerEvent; controller: AbortController; isSweeping: boolean } | undefined
  let lastPress: { at: number; x: number; y: number } | undefined

  element.addEventListener("pointerdown", (event) => {
    release()
    const previous = lastPress
    lastPress = { at: event.timeStamp, x: event.pageX, y: event.pageY }
    const isSecondPress =
      previous !== undefined &&
      event.timeStamp - previous.at <= (secondPressWithin ?? 0) &&
      distance(previous, lastPress) <= (event.pointerType === "touch" ? 24 : DOUBLE_PRESS_PX)
    if (secondPressWithin !== undefined && !isSecondPress) return
    press = { start: event, latest: event, controller: new AbortController(), isSweeping: false }
    sweep(press)
  })
  element.addEventListener("pointermove", (event) => {
    if (!press) return
    press.latest = event
    const { start, isSweeping } = press
    const { center, radius } = isSweeping ? circleOf(element) : { center: { x: start.pageX, y: start.pageY }, radius: STILL_TOLERANCE_PX }
    const touchCenter = event.pointerType === "touch" ? { x: start.pageX, y: start.pageY } : center
    if (distance({ x: event.pageX, y: event.pageY }, touchCenter) > (event.pointerType === "touch" ? 24 : radius)) release()
  })
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) element.addEventListener(type, release)

  async function sweep(held: NonNullable<typeof press>) {
    const { signal } = held.controller
    for await (const fill of fillProgress(ms, signal, SWEEP_DELAY_MS)) {
      if (fill > 0 && !held.isSweeping) {
        held.isSweeping = true
        onSweep?.()
      }
      element.toggleAttribute("data-holding", fill > 0)
      element.style.setProperty("--fill", `${fill}`)
    }
    element.removeAttribute("data-holding")
    element.style.removeProperty("--fill")
    if (held.isSweeping) onSweepEnd?.(!signal.aborted)
    if (!signal.aborted) onHold(held.latest)
  }

  function release() {
    press?.controller.abort()
    press = undefined
  }
}

/** Yields progress once per animation frame, staying at 0 for `delayMs` then reaching 1 over `ms`; stops early once `signal` aborts. */
async function* fillProgress(ms: number, signal: AbortSignal, delayMs = 0) {
  const start = performance.now() + delayMs
  let fill = 0
  while (fill < 1) {
    const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve))
    if (signal.aborted) return
    fill = Math.min(1, Math.max(0, (now - start) / ms))
    yield fill
  }
}
