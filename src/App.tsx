import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, CircleCheck, Play, Settings, Timer } from 'lucide-react'
import Wizard from './Wizard'
import Manage from './Manage'
import {
  db,
  logCompletion,
  undoLastCompletion,
  redoCompletion,
  msUntilDue,
  percentDue,
  urgencyBand,
  axisFrac,
  axisX,
  hornPath,
  notchTicks,
  fillStartX,
  cycleColor,
  outlineColor,
  severeOverdue,
  formatDueShort,
  formatLastCompleted,
  randomizeTaskState,
  type Task,
  type Room,
  type CompletionLog,
} from './lib/db'
import { roomIcon, iconForTask } from './lib/icons'

// Duration wheel values for the "Complete" path's Apple-timer-style picker —
// 5-minute increments from 5 to 90. Reused as-is for Focus mode's "how many
// minutes" picker.
const WHEEL_VALUES = Array.from({ length: 18 }, (_, i) => (i + 1) * 5)

// Focus mode ("give me X minutes"): a task is eligible for the plan once
// it's at least 75% through its cycle — the 'soon' and 'overdue' urgency
// bands. Freshly-done tasks are never suggested.
const FOCUS_ELIGIBLE_PD = 75

// The drop's fill/path geometry is defined on a 0-200 x-axis (see db.ts's
// X0/X_RIGHT), but the bar's SVG viewBox starts slightly left of that (at
// BAR_VIEWBOX_X, width BAR_VIEWBOX_W) so the left rounded cap's *stroke* —
// which, unlike the fill, overflows past the path's own x=0 edge by half its
// strokeWidth (up to 1.2 units for the 2.4-wide reset-blink flash) — has
// margin to render instead of getting clipped at the viewport edge. The
// right edge is left unchanged (BAR_VIEWBOX_X + BAR_VIEWBOX_W = 200) since
// the drop's tip never reaches past ~197.25 there already.
const BAR_VIEWBOX_X = -1.5
const BAR_VIEWBOX_W = 201.5

// Shared due-time axis ticks, positioned with the same axisX/axisFrac used by
// every task's bar so the legend lines up with the bars underneath it —
// converted from a viewBox x to a % of width using the bar's actual viewBox
// origin/span (BAR_VIEWBOX_X/_W) so the ticks stay aligned with the bars.
const AXIS_TICKS = [
  { label: '1d', percent: ((axisX(axisFrac(1)) - BAR_VIEWBOX_X) / BAR_VIEWBOX_W) * 100 },
  { label: '3d', percent: ((axisX(axisFrac(3)) - BAR_VIEWBOX_X) / BAR_VIEWBOX_W) * 100 },
  { label: '1w', percent: ((axisX(axisFrac(7)) - BAR_VIEWBOX_X) / BAR_VIEWBOX_W) * 100 },
  { label: '2w', percent: ((axisX(axisFrac(14)) - BAR_VIEWBOX_X) / BAR_VIEWBOX_W) * 100 },
]

type ViewMode = 'urgency' | 'room'
const VIEW_MODE_KEY = 'cleaning-planner:viewMode'

function loadViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'room' ? 'room' : 'urgency'
  } catch {
    return 'urgency'
  }
}

const FLIP_DURATION_MS = 550
const FLIP_EASING = 'cubic-bezier(0.25, 0.8, 0.25, 1)'

/**
 * Dependency-free FLIP (First-Last-Invert-Play) list reorder: whenever a
 * task's `<li>` moves between renders (a completion, or randomize, re-sorts
 * the list), it glides to its new spot instead of jumping. Compares
 * `offsetTop` (not `getBoundingClientRect`, which would be thrown off by
 * scroll position) captured on the *previous* render against the current
 * one, then plays the delta back as a transform that eases to zero.
 *
 * Suppressed across a `shapeKey` change (Urgency ↔ Rooms, or entering/
 * exiting Focus mode) — that's a different list shape, not a reorder, so
 * the previous-position map is dropped instead of diffed. Only applies to
 * each task's own `<li>`; a room *section* reordering in Rooms view is not
 * animated (its header/list wrapper isn't tracked here) — see CLAUDE.md.
 */
function useFlip(shapeKey: string) {
  const elsRef = useRef(new Map<number, HTMLElement>())
  const prevTopsRef = useRef(new Map<number, number>())
  const prevShapeKeyRef = useRef(shapeKey)

  useLayoutEffect(() => {
    const viewChanged = prevShapeKeyRef.current !== shapeKey
    prevShapeKeyRef.current = shapeKey
    if (viewChanged) prevTopsRef.current.clear()

    const moves: Array<[HTMLElement, number]> = []
    elsRef.current.forEach((el, id) => {
      const top = el.offsetTop
      const old = prevTopsRef.current.get(id)
      if (!viewChanged && old !== undefined && Math.abs(old - top) > 1) {
        moves.push([el, old - top])
      }
      prevTopsRef.current.set(id, top)
    })
    if (moves.length === 0) return

    moves.forEach(([el, dy]) => {
      el.style.transition = 'none'
      el.style.transform = `translateY(${dy}px)`
    })
    void document.body.offsetHeight // force reflow so the jump above commits before easing back
    moves.forEach(([el]) => {
      el.style.transition = `transform ${FLIP_DURATION_MS}ms ${FLIP_EASING}`
      el.style.transform = ''
      el.addEventListener(
        'transitionend',
        () => {
          el.style.transition = ''
          el.style.transform = ''
        },
        { once: true },
      )
    })
  })

  return (id: number) => (el: HTMLElement | null) => {
    if (el) elsRef.current.set(id, el)
    else elsRef.current.delete(id)
  }
}

// ---------------------------------------------------------------------------
// Duration wheel (iOS-timer-style scroll picker)
// ---------------------------------------------------------------------------

const WHEEL_ITEM_W = 56
const WHEEL_ROW_H = 40

// A solid rounded pill for small-text controls (time readout, wheel) that
// float over a blurred tile — needs its own opaque-ish background since the
// tile behind it is blurred/dimmed and would otherwise muddy fine text.
const PILL =
  'rounded-full bg-white/95 dark:bg-neutral-900/95 shadow-sm ring-1 ring-black/5 dark:ring-white/10'

// Every completion-flow button: a frosted capsule (translucent card color +
// blur, so the blurred tile glows through) rather than a solid color, per
// the "no blue/green" restyle — the pulsing stopwatch dot is the one
// remaining color accent.
const FROSTED_BTN =
  'inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-black/5 dark:border-white/10 bg-white/60 dark:bg-neutral-900/60 backdrop-blur-md text-sm font-semibold text-neutral-900 dark:text-neutral-100 active:bg-white/80 dark:active:bg-neutral-900/80 transition-colors'

/**
 * A horizontal scroll-snap wheel of minute values, à la the iOS timer picker
 * turned on its side. The centered column is the selection; scrolling
 * changes it. Uncontrolled scroll position, initialized once to `value`,
 * then reports changes up via onChange as the user scrolls/snaps.
 */
function WheelPicker({
  values,
  value,
  onChange,
}: {
  values: number[]
  value: number
  onChange: (v: number) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Reconcile the highlighted/reported value from wherever the wheel is
  // actually scrolled to — used both live (onScroll) and to settle the
  // initial centering below, so the centered column and `value` never
  // disagree.
  const handleScroll = () => {
    const el = ref.current
    if (!el) return
    const idx = Math.min(
      values.length - 1,
      Math.max(0, Math.round(el.scrollLeft / WHEEL_ITEM_W)),
    )
    const next = values[idx]
    if (next !== value) onChange(next)
  }

  // Center the initial value on mount. Runs once — afterward the user drives
  // scroll position directly. Uses useLayoutEffect (not useEffect) so the
  // assignment happens before paint, and re-asserts it in a rAF because the
  // surrounding panel is still settling its `panel-pop` layout at mount time,
  // which can otherwise clamp scrollLeft back to 0. Reconciling afterward
  // guarantees the visually centered column matches `value`.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const idx = Math.max(0, values.indexOf(value))
    el.scrollLeft = idx * WHEEL_ITEM_W
    const raf = requestAnimationFrame(() => {
      el.scrollLeft = idx * WHEEL_ITEM_W
      handleScroll()
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className={`relative flex-1 overflow-hidden ${PILL}`} style={{ height: WHEEL_ROW_H }}>
      {/* selection band behind the centered column */}
      <div
        className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-full bg-neutral-100 dark:bg-neutral-800"
        style={{ width: WHEEL_ITEM_W }}
        aria-hidden="true"
      />
      <div
        ref={ref}
        onScroll={handleScroll}
        className="wheel-scroll relative flex h-full snap-x snap-mandatory overflow-x-scroll"
      >
        <div className="shrink-0" style={{ width: `calc(50% - ${WHEEL_ITEM_W / 2}px)` }} />
        {values.map((v) => {
          const selected = v === value
          return (
            <div
              key={v}
              className={`flex h-full shrink-0 snap-center items-center justify-center tabular-nums transition-colors ${
                selected
                  ? 'text-base font-bold text-neutral-900 dark:text-neutral-100'
                  : 'text-sm font-medium text-neutral-400 dark:text-neutral-600'
              }`}
              style={{ width: WHEEL_ITEM_W }}
            >
              {v}
            </div>
          )
        })}
        <div className="shrink-0" style={{ width: `calc(50% - ${WHEEL_ITEM_W / 2}px)` }} />
      </div>
      {/* soft left/right fades so off-center values recede, matching the
          pill's own (near-opaque) background so the fade itself is invisible */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-2/5 bg-gradient-to-r from-white/95 to-transparent dark:from-neutral-900/95" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-2/5 bg-gradient-to-l from-white/95 to-transparent dark:from-neutral-900/95" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Task card + its completion interaction
// ---------------------------------------------------------------------------

type Interaction = 'idle' | 'prompt' | 'stopwatch' | 'wheel'
// 'settled' holds the animation's captured fresh-green state after the
// blinks finish, so the card doesn't flash back to its old (e.g. overdue)
// live state in the gap before the DB write lands and the live query
// refreshes `task`.
type ResetAnim = { phase: 'drain' | 'blink' | 'settled'; color: string; stroke: string }

// The reset animation's drain target: the fresh (just-completed) cycle-state
// colors, i.e. cycleColor/outlineColor at 0% due. Matches db.ts's GREEN color
// stop and outlineColor's 22%-toward-black darkening formula, so the drain's
// end color agrees exactly with the card's actual fresh-state colors.
const FRESH_GREEN: [number, number, number] = [94, 160, 46] // #5ea02e
const FRESH_GREEN_OUTLINE: [number, number, number] = [73, 125, 36] // #497d24
const RESET_GREEN = '#22c55e'
const DRAIN_DURATION_MS = 1400
const BLINK_ITERATION_MS = 380
const BLINK_ITERATIONS = 3
// Beat between the last blink and the deferred DB write, so the write (and
// the list re-sort it triggers) lands a moment after the animation visually
// finishes rather than right on its last frame.
const BEAT_MS = 200
// Safety net: if the live query never reflects the write (e.g. it failed),
// stop holding the settled state open forever.
const SETTLE_FALLBACK_MS = 2000

// Long-press (undo-completion sheet) tuning: how long a press must hold
// before it counts as a long-press, and how far the pointer may drift before
// it's treated as a scroll gesture instead and the press is cancelled.
const LONG_PRESS_MS = 500
const LONG_PRESS_MOVE_TOLERANCE_PX = 10

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgbToHex = (c: readonly number[]) =>
  '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const mixRgb = (
  a: readonly number[],
  b: readonly number[],
  t: number,
): number[] => a.map((v, i) => v + (b[i] - v) * t)

/**
 * A single task card. Collapsed, the whole tile is a tap target. Tapping lifts
 * a panel on top of the tile offering Start (run a stopwatch) or Complete (pick
 * a duration on a wheel). Either path logs the completion and plays a reset
 * animation: the drop's time-fill drains out to the right, then its outline
 * blinks green three times.
 */
function TaskCard({
  task,
  room,
  showRoomLabel,
  showEstimate = false,
  isActive,
  onActivate,
  onClose,
  onLongPress,
  flipRef,
}: {
  task: Task
  room: Room | undefined
  showRoomLabel: boolean
  /** Focus mode only: a small muted "~Xm" after the room label, showing estimatedDurationMinutes. */
  showEstimate?: boolean
  isActive: boolean
  onActivate: () => void
  onClose: () => void
  /** Long-press (~500ms, held roughly in place): opens the undo-last-completion sheet for this task. */
  onLongPress: () => void
  flipRef: (el: HTMLLIElement | null) => void
}) {
  const [mode, setMode] = useState<Interaction>('idle')

  // Stopwatch state (Start path).
  const swStartRef = useRef<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  // Wheel state (Complete path).
  const [wheelValue, setWheelValue] = useState(task.estimatedDurationMinutes)

  // Reset animation state (plays after either completion path).
  const [anim, setAnim] = useState<ResetAnim | null>(null)
  const [drainX, setDrainX] = useState(0)
  const rafRef = useRef<number | null>(null)
  const timeoutsRef = useRef<number[]>([])
  // logCompletion is deferred until after the full drain+blink animation (see
  // playReset). These track that pending write so it still fires exactly
  // once even if the card unmounts mid-animation (e.g. a view toggle).
  const pendingCompleteRef = useRef<{ minutes: number } | null>(null)
  const loggedRef = useRef(false)

  // Long-press (undo-completion sheet) tracking.
  const longPressTimerRef = useRef<number | null>(null)
  const longPressFiredRef = useRef(false)
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null)

  // Collapse this card's interaction if another card becomes the active one.
  // Never interrupts an in-flight reset animation (that lives in `anim`).
  useEffect(() => {
    if (!isActive) {
      setMode('idle')
      swStartRef.current = null
      setElapsedMs(0)
    }
  }, [isActive])

  // Tick the stopwatch frequently enough that the seconds display never
  // visibly skips. Elapsed time is always recomputed from swStartRef, not
  // accumulated per tick, so drift can't creep in between ticks.
  useEffect(() => {
    if (mode !== 'stopwatch' || swStartRef.current === null) return
    const id = window.setInterval(() => {
      if (swStartRef.current !== null) setElapsedMs(Date.now() - swStartRef.current)
    }, 300)
    return () => window.clearInterval(id)
  }, [mode])

  // Clean up a running rAF and any pending timeouts on unmount. If the reset
  // animation was interrupted before the deferred logCompletion fired (at any
  // point through drain, blink, or the beat before the write), the
  // completion must still be logged — fire it here so the write is never
  // lost.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      timeoutsRef.current.forEach((id) => window.clearTimeout(id))
      timeoutsRef.current = []
      if (pendingCompleteRef.current && !loggedRef.current) {
        loggedRef.current = true
        void logCompletion(task.id, {
          actualDurationMinutes: pendingCompleteRef.current.minutes,
        })
      }
      if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Once the deferred write actually lands — i.e. the live query refreshes
  // this task and its lastCompletedDate changes — clear the settled anim so
  // the card switches over to its real live (fresh) state. Watching the prop
  // rather than using a timer keeps this deterministic; SETTLE_FALLBACK_MS in
  // playReset is just a safety net in case the write never lands.
  const prevCompletedRef = useRef(task.lastCompletedDate)
  useEffect(() => {
    if (task.lastCompletedDate !== prevCompletedRef.current) {
      prevCompletedRef.current = task.lastCompletedDate
      setAnim(null)
    }
  }, [task.lastCompletedDate])

  // Long-press vs. tap vs. scroll: a timer starts on pointerdown and fires
  // onLongPress if it isn't cancelled first. It's cancelled by pointerup/
  // cancel (a normal tap or release), or by the pointer drifting more than
  // LONG_PRESS_MOVE_TOLERANCE_PX (treated as the start of a scroll, not a
  // long-press hold) — the tile itself is a plain button, not a touch-move
  // listener, so this drift check is what keeps a long-press attempt from
  // swallowing an iOS scroll gesture. `touch-action: pan-y` on the button
  // (below) does the same for the browser's own gesture recognizer.
  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (open) return
    pointerStartRef.current = { x: e.clientX, y: e.clientY }
    longPressFiredRef.current = false
    clearLongPressTimer()
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null
      longPressFiredRef.current = true
      onLongPress()
    }, LONG_PRESS_MS)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    const start = pointerStartRef.current
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE_PX) clearLongPressTimer()
  }

  const handlePointerUp = () => {
    clearLongPressTimer()
  }

  // A long-press that fired still generates a trailing click once the
  // pointer lifts — swallow exactly that one so it doesn't also open the
  // Start/Complete prompt.
  const handleClick = () => {
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false
      return
    }
    openPrompt()
  }

  const openPrompt = () => {
    onActivate()
    setMode('prompt')
  }

  const cancel = () => {
    setMode('idle')
    swStartRef.current = null
    setElapsedMs(0)
    onClose()
  }

  const startStopwatch = () => {
    swStartRef.current = Date.now()
    setElapsedMs(0)
    setMode('stopwatch')
  }

  const openWheel = () => {
    // Default the wheel to the task's current adaptive estimate, snapped to the
    // nearest 5 min and clamped into the wheel's range.
    const snapped = Math.round(task.estimatedDurationMinutes / 5) * 5
    const est = Math.min(
      WHEEL_VALUES[WHEEL_VALUES.length - 1],
      Math.max(WHEEL_VALUES[0], snapped),
    )
    setWheelValue(est)
    setMode('wheel')
  }

  // Plays the drain-then-blink reset, in place, before anything moves.
  // Captures the drop's current fill/colors *before* the DB update lands,
  // then animates from that captured state so the fill visibly empties out
  // and its color cools to fresh-state green — isolated from the live
  // query's refresh of the now-fresh task. Sequence: drain (~1.4s) → 3
  // blinks in place → a short beat → the deferred DB write lands (only then
  // does the list re-sort/glide — see useFlip). `anim` stays non-null
  // (phase 'settled') through the beat and past the write so the card never
  // flashes back to its old live state in the gap before the live query
  // catches up; the lastCompletedDate-watching effect above clears it once
  // that actually happens.
  const playReset = (minutes: number) => {
    const startColor = hexToRgb(cycleColor(task))
    const startStroke = hexToRgb(outlineColor(task))
    const startSx = fillStartX(task)

    setMode('idle')
    swStartRef.current = null
    setElapsedMs(0)
    onClose()

    pendingCompleteRef.current = { minutes }
    loggedRef.current = false

    setAnim({ phase: 'drain', color: rgbToHex(startColor), stroke: rgbToHex(startStroke) })
    setDrainX(startSx)

    const t0 = performance.now()
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / DRAIN_DURATION_MS)
      const eased = 1 - Math.pow(1 - p, 3) // easeOutCubic
      setDrainX(startSx + (200 - startSx) * eased)
      setAnim({
        phase: 'drain',
        color: rgbToHex(mixRgb(startColor, FRESH_GREEN, eased)),
        stroke: rgbToHex(mixRgb(startStroke, FRESH_GREEN_OUTLINE, eased)),
      })
      if (p < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = null
        const freshColor = rgbToHex(FRESH_GREEN)
        const freshStroke = rgbToHex(FRESH_GREEN_OUTLINE)
        setAnim({ phase: 'blink', color: freshColor, stroke: freshStroke })

        const blinkTimeout = window.setTimeout(() => {
          setAnim({ phase: 'settled', color: freshColor, stroke: freshStroke })

          const beatTimeout = window.setTimeout(() => {
            if (!loggedRef.current) {
              loggedRef.current = true
              pendingCompleteRef.current = null
              void logCompletion(task.id, { actualDurationMinutes: minutes })
            }
            const fallbackTimeout = window.setTimeout(() => {
              setAnim((a) => (a && a.phase === 'settled' ? null : a))
            }, SETTLE_FALLBACK_MS)
            timeoutsRef.current.push(fallbackTimeout)
          }, BEAT_MS)
          timeoutsRef.current.push(beatTimeout)
        }, BLINK_ITERATION_MS * BLINK_ITERATIONS)
        timeoutsRef.current.push(blinkTimeout)
      }
    }
    rafRef.current = requestAnimationFrame(step)
  }

  const complete = (minutes: number) => {
    playReset(minutes)
  }

  const finishStopwatch = () => {
    const minutesElapsed = elapsedMs / 60000
    // Store rounded to the nearest 5 minutes, never below 5.
    const stored = Math.max(5, Math.round(minutesElapsed / 5) * 5)
    complete(stored)
  }

  // --- drop bar geometry / colors -----------------------------------------
  const band = urgencyBand(task)
  const Icon = iconForTask(task)
  const RoomLabelIcon = room ? roomIcon(room.type) : null
  const path = hornPath(task.frequencyDays)

  const animating = anim !== null
  const sx = animating ? drainX : fillStartX(task)
  const fill = animating ? anim.color : cycleColor(task)
  const stroke = animating ? anim.stroke : outlineColor(task)
  const sw = !animating && severeOverdue(task) ? 0.9 : 0.7

  const statusColor =
    band === 'overdue'
      ? 'text-red-600 dark:text-red-400'
      : band === 'soon'
        ? 'text-amber-600 dark:text-amber-500'
        : 'text-neutral-400 dark:text-neutral-500'

  const cardFace = (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Icon
            className="h-5 w-5 shrink-0 text-neutral-500 dark:text-neutral-400"
            strokeWidth={2}
            aria-hidden="true"
          />
          <div className="flex min-w-0 items-baseline gap-1.5">
            <p className="min-w-0 flex-1 truncate text-left text-[15px] font-medium text-neutral-900 dark:text-neutral-100">
              {task.name}
            </p>
            {showRoomLabel && room && RoomLabelIcon && (
              <span className="flex shrink-0 items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500">
                <RoomLabelIcon className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
                {room.name}
              </span>
            )}
            {showEstimate && (
              <span className="shrink-0 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                ~{task.estimatedDurationMinutes}m
              </span>
            )}
          </div>
        </div>
        <span className={`shrink-0 text-xs font-semibold ${statusColor}`}>
          {formatDueShort(task)}
        </span>
      </div>

      <svg
        viewBox={`${BAR_VIEWBOX_X} 0 ${BAR_VIEWBOX_W} 20`}
        width="100%"
        className="mt-2.5 block"
      >
        <defs>
          <clipPath id={`fill-${task.id}`}>
            <rect x={sx} y={0} width={200} height={20} />
          </clipPath>
        </defs>
        {/* time fill: solid, right-anchored to the cycle end */}
        <path d={path} fill={fill} clipPath={`url(#fill-${task.id})`} />
        {/* cycle-state outline: thin, always visible (shows freshness when empty) */}
        <path d={path} fill="none" stroke={stroke} strokeWidth={sw} />
        {/* day ruler: daily notches centered on the top + bottom outline, in
            the drop's own (slightly darker) color — thicker/bolder near today,
            fading out as the drop thins toward 1 week */}
        <g stroke={stroke} strokeLinecap="round">
          {notchTicks(task.frequencyDays).map((tk) => {
            const len = 1.2 + tk.fade * 2.3 // total length, straddling the outline
            const opacity = tk.fade * 0.65
            const width = 0.5 + tk.fade * 0.8 // 1d notch is the thickest
            const top = 10 - tk.half
            const bot = 10 + tk.half
            return (
              <g key={tk.x} strokeOpacity={opacity} strokeWidth={width}>
                <line x1={tk.x} y1={top - len / 2} x2={tk.x} y2={top + len / 2} />
                <line x1={tk.x} y1={bot - len / 2} x2={tk.x} y2={bot + len / 2} />
              </g>
            )
          })}
        </g>
        {/* reset blink: a green outline flash overlaid at the end of the reset */}
        {anim?.phase === 'blink' && (
          <path
            d={path}
            fill="none"
            stroke={RESET_GREEN}
            strokeWidth={2.4}
            strokeLinejoin="round"
            className="reset-blink"
          />
        )}
      </svg>
    </>
  )

  const open = mode !== 'idle'

  return (
    <li
      ref={flipRef}
      className={`relative rounded-xl bg-white shadow-sm dark:bg-neutral-900 ${open ? 'z-30' : ''}`}
    >
      {/* Base tile — always rendered; blurs behind the prompt when open. */}
      <button
        type="button"
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          touchAction: 'pan-y',
          WebkitTouchCallout: 'none',
          WebkitUserSelect: 'none',
          userSelect: 'none',
        }}
        aria-label={`Complete "${task.name}"`}
        className={`block w-full rounded-xl p-3 transition ${
          open
            ? 'pointer-events-none'
            : 'duration-100 active:scale-[0.97] active:bg-neutral-50 dark:active:bg-neutral-800'
        }`}
      >
        <div className={open ? 'blur-[2px] opacity-60' : ''}>{cardFace}</div>
      </button>

      {open && (
        <>
          {/* Tap anywhere outside the tile to dismiss. */}
          <div className="fixed inset-0 z-20" onClick={cancel} aria-hidden="true" />

          {mode === 'prompt' && (
            // Start / Complete float on top of the blurred tile.
            <div className="panel-pop absolute inset-0 z-30 flex items-center justify-center gap-2 overflow-hidden rounded-xl px-3">
              <button type="button" onClick={startStopwatch} className={`flex-1 py-2.5 ${FROSTED_BTN}`}>
                <Play className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden="true" />
                Start
              </button>
              <button type="button" onClick={openWheel} className={`flex-1 py-2.5 ${FROSTED_BTN}`}>
                <Check className="h-[15px] w-[15px]" aria-hidden="true" />
                Complete
              </button>
            </div>
          )}

          {mode === 'stopwatch' && (
            // Elapsed-time pill + Done float on top of the blurred tile.
            <div className="panel-pop absolute inset-0 z-30 flex items-center justify-center gap-2 overflow-hidden rounded-xl px-3">
              <div className={`flex items-center gap-2 px-4 py-2 ${PILL}`}>
                <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" aria-hidden="true" />
                <span className="text-xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
                  {Math.floor(elapsedMs / 60000)}:
                  {String(Math.floor(elapsedMs / 1000) % 60).padStart(2, '0')}
                </span>
              </div>
              <button type="button" onClick={finishStopwatch} className={`shrink-0 px-5 py-2 ${FROSTED_BTN}`}>
                <Check className="h-[15px] w-[15px]" aria-hidden="true" />
                Done
              </button>
            </div>
          )}

          {mode === 'wheel' && (
            // Wheel pill + Done float on top of the blurred tile.
            <div className="panel-pop absolute inset-0 z-30 flex items-center gap-2 overflow-hidden rounded-xl px-3">
              <WheelPicker values={WHEEL_VALUES} value={wheelValue} onChange={setWheelValue} />
              <button
                type="button"
                onClick={() => complete(wheelValue)}
                className={`min-w-[84px] shrink-0 px-4 py-2 ${FROSTED_BTN}`}
              >
                <Check className="h-[15px] w-[15px]" aria-hidden="true" />
                <span className="tabular-nums">{wheelValue}m</span>
              </button>
            </div>
          )}
        </>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Undo-last-completion sheet (long-press a task tile)
// ---------------------------------------------------------------------------

/**
 * A small bottom sheet for one task, opened by long-pressing its tile.
 * Undo deletes the task's most recent CompletionLog and rewinds
 * lastCompletedDate/estimatedDurationMinutes to match; while `canRedo` is
 * true (the App-level in-memory record of an undo not yet superseded by
 * another completion) it offers "Redo completion" instead, restoring exactly
 * what was removed. Disabled (with a note) if the task has no completion log
 * to undo.
 */
function UndoSheet({
  task,
  canRedo,
  onUndo,
  onRedo,
  onCancel,
}: {
  task: Task
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onCancel: () => void
}) {
  const logCount = useLiveQuery(
    () => db.completionLogs.where('taskId').equals(task.id).count(),
    [task.id],
  )
  const canUndo = (logCount ?? 0) > 0

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onCancel} aria-hidden="true" />
      <div className="absolute inset-x-0 bottom-0 mx-auto max-w-md rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg dark:bg-neutral-900">
        <p className="text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{task.name}</p>
        <p className="mt-0.5 text-[13px] text-neutral-500 dark:text-neutral-400">
          Last completed: {formatLastCompleted(task)}
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-black/5 bg-white py-2.5 text-[13.5px] font-semibold text-neutral-900 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
          >
            Cancel
          </button>
          {canRedo ? (
            <button
              type="button"
              onClick={onRedo}
              className="flex-1 rounded-lg bg-neutral-900 py-2.5 text-[13.5px] font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              Redo completion
            </button>
          ) : (
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="flex-1 rounded-lg bg-neutral-900 py-2.5 text-[13.5px] font-semibold text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
            >
              Undo last completion
            </button>
          )}
        </div>
        {!canRedo && !canUndo && (
          <p className="mt-2 text-center text-[12px] text-neutral-400 dark:text-neutral-500">
            No completions logged for this task yet.
          </p>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Focus mode ("give me X minutes") — pick a time budget, get a static,
// greedily-packed subset of due/overdue tasks to work through.
// ---------------------------------------------------------------------------

/**
 * A Focus plan, computed once when "Go" is tapped and never recomputed —
 * `ids` is the fixed set of picked tasks in urgency order, `planStart` is
 * used to tell whether a planned task has since been completed (its
 * `lastCompletedDate` moved past `planStart`), independent of the live
 * query refreshing the task object itself.
 */
interface FocusPlan {
  ids: number[]
  budget: number
  /** How many eligible due/overdue tasks didn't fit and were left out. */
  skipped: number
  /** Total tasks picked at plan time (fixed — used for the "All done" copy). */
  planned: number
  /** Leftover budget minutes after packing, at plan time. */
  left: number
  planStart: number
}

/** A planned task counts as done once it's been completed after the plan started. */
function isPlannedTaskDone(task: Task, plan: FocusPlan): boolean {
  return task.lastCompletedDate !== null && task.lastCompletedDate > plan.planStart
}

const FOCUS_INV =
  'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'

/** The inverted plan banner that replaces the view-toggle row while a Focus plan is active. */
function FocusBanner({
  remainingCount,
  remainingMinutes,
  plan,
  onExit,
}: {
  remainingCount: number
  remainingMinutes: number
  plan: FocusPlan
  onExit: () => void
}) {
  const allDone = remainingCount === 0
  const hadPlan = plan.planned > 0

  return (
    <div className={`flex h-10 items-center gap-2.5 rounded-lg px-3 ${FOCUS_INV}`}>
      <Timer className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
      <div className="min-w-0 flex-1 truncate text-[12.5px] font-semibold leading-tight">
        {allDone ? (hadPlan ? 'All done' : 'Nothing due right now') : `${remainingCount} task${remainingCount === 1 ? '' : 's'} · ~${remainingMinutes} min planned`}
        <div className="truncate text-[10.5px] font-normal opacity-65">
          {allDone
            ? hadPlan
              ? `that was your ${plan.budget} minutes well spent`
              : `enjoy your ${plan.budget} minutes`
            : `fits your ${plan.budget} minutes${plan.skipped ? ` · ${plan.skipped} due task${plan.skipped === 1 ? '' : 's'} didn't fit` : ''}`}
        </div>
      </div>
      <button
        type="button"
        onClick={onExit}
        aria-label="Exit focus mode"
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md bg-white/15 text-[13px] leading-none dark:bg-black/10"
      >
        ✕
      </button>
    </div>
  )
}

/** The quiet end-of-plan state — no confetti, no streaks. */
function FocusEndState({
  kind,
  planned,
  budget,
  onBack,
}: {
  kind: 'done' | 'empty'
  planned: number
  budget: number
  onBack: () => void
}) {
  return (
    <div className="mt-12 text-center">
      <CircleCheck
        className="mx-auto mb-2.5 h-11 w-11 text-[#5ea02e]"
        strokeWidth={1.6}
        aria-hidden="true"
      />
      {kind === 'done' ? (
        <>
          <h3 className="mb-1 text-[17px] font-bold text-neutral-900 dark:text-neutral-100">All done</h3>
          <p className="mb-4 text-[13px] text-neutral-500 dark:text-neutral-400">
            {planned} task{planned === 1 ? '' : 's'} in under {budget} minutes.
          </p>
        </>
      ) : (
        <p className="mb-4 text-[13px] text-neutral-500 dark:text-neutral-400">
          Nothing due right now — enjoy your {budget} minutes.
        </p>
      )}
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg border border-black/5 bg-white px-5 py-2.5 text-[13.5px] font-semibold text-neutral-900 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
      >
        Back to the full list
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------

function App() {
  const tasks = useLiveQuery(() => db.tasks.toArray())
  const rooms = useLiveQuery(() => db.rooms.toArray())

  const [screen, setScreen] = useState<'list' | 'manage'>('list')
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode)

  // Focus mode ("give me X minutes") — in-memory only, never persisted.
  // 'pickMinutes' remembers the last-picked value for the session so
  // reopening the picker after a Cancel doesn't reset to the 30-min default.
  const [focusScreen, setFocusScreen] = useState<'normal' | 'pick' | 'focus'>('normal')
  const [pickMinutes, setPickMinutes] = useState(30)
  const [plan, setPlan] = useState<FocusPlan | null>(null)

  // Undo-last-completion sheet — which task's sheet is open (long-press), and
  // an in-memory (session-only, never persisted) record of the most recent
  // undo per task so a second long-press can offer "Redo completion". A
  // task's entry is only honored while its lastCompletedDate still matches
  // what the undo left it at — any newer completion (or another edit)
  // invalidates it without needing to hook into every mutation path.
  const [undoSheetTaskId, setUndoSheetTaskId] = useState<number | null>(null)
  const [undoneByTaskId, setUndoneByTaskId] = useState<
    Map<number, { log: CompletionLog; lastCompletedDateAfterUndo: number | null }>
  >(new Map())

  // A different key than viewMode alone so entering/exiting Focus mode also
  // suppresses FLIP across the drastic list-shape change (full list <-> the
  // filtered plan), while completions *within* an active plan still glide
  // normally (the key stays 'focus' the whole time a plan is active).
  const flip = useFlip(focusScreen === 'focus' ? 'focus' : viewMode)

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode)
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode)
    } catch {
      // localStorage unavailable (e.g. private mode) — keep the in-memory choice.
    }
  }

  if (!tasks || !rooms) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-neutral-100 dark:bg-neutral-950">
        <p className="text-neutral-400 dark:text-neutral-500">Loading…</p>
      </div>
    )
  }

  // No rooms yet means this is a fresh install (or the DEV-only seed/reset
  // hasn't run) — hand off to the setup wizard instead of an empty list. The
  // wizard writes directly to Dexie; this live query picks the new rooms up
  // and swaps back to the list on its own, no callback needed.
  if (rooms.length === 0) {
    return <Wizard />
  }

  if (screen === 'manage') {
    return <Manage onBack={() => setScreen('list')} />
  }

  const roomsById = new Map<number, Room>(rooms.map((room) => [room.id, room]))

  // Flat, most-urgent-first list of every task — the default glanceable view.
  const sortedTasks = [...tasks].sort((a, b) => msUntilDue(a) - msUntilDue(b))

  // Group tasks under their room, most-urgent task first within each room, and
  // float the room containing the most-urgent task to the top. Empty rooms drop.
  const roomGroups = rooms
    .map((room) => ({
      room,
      tasks: tasks
        .filter((task) => task.roomId === room.id)
        .sort((a, b) => msUntilDue(a) - msUntilDue(b)),
    }))
    .filter((group) => group.tasks.length > 0)
    .sort((a, b) => msUntilDue(a.tasks[0]) - msUntilDue(b.tasks[0]))

  const renderTask = (task: Task, showRoomLabel: boolean, showEstimate = false) => (
    <TaskCard
      key={task.id}
      task={task}
      room={roomsById.get(task.roomId)}
      showRoomLabel={showRoomLabel}
      showEstimate={showEstimate}
      isActive={activeTaskId === task.id}
      onActivate={() => setActiveTaskId(task.id)}
      onClose={() => setActiveTaskId((id) => (id === task.id ? null : id))}
      onLongPress={() => setUndoSheetTaskId(task.id)}
      flipRef={flip(task.id)}
    />
  )

  const hasTasks = tasks.length > 0

  const undoSheetTask = undoSheetTaskId !== null ? tasks.find((t) => t.id === undoSheetTaskId) : undefined
  const undoneForSheetTask = undoSheetTask ? undoneByTaskId.get(undoSheetTask.id) : undefined
  const undoSheetCanRedo =
    !!undoneForSheetTask &&
    !!undoSheetTask &&
    undoSheetTask.lastCompletedDate === undoneForSheetTask.lastCompletedDateAfterUndo

  const handleUndoCompletion = async () => {
    if (!undoSheetTask) return
    const result = await undoLastCompletion(undoSheetTask.id)
    if (result) {
      setUndoneByTaskId((prev) => {
        const next = new Map(prev)
        next.set(undoSheetTask.id, {
          log: result.log,
          lastCompletedDateAfterUndo: result.newLastCompletedDate,
        })
        return next
      })
    }
    setUndoSheetTaskId(null)
  }

  const handleRedoCompletion = async () => {
    if (!undoSheetTask || !undoneForSheetTask) return
    await redoCompletion(undoneForSheetTask.log)
    setUndoneByTaskId((prev) => {
      const next = new Map(prev)
      next.delete(undoSheetTask.id)
      return next
    })
    setUndoSheetTaskId(null)
  }

  // The greedy fill — this IS the feature. Computed once, on Go; stored as a
  // fixed set of ids so it never recomputes as time passes or tasks complete.
  const startFocus = () => {
    const eligible = tasks
      .filter((task) => percentDue(task) >= FOCUS_ELIGIBLE_PD)
      .sort((a, b) => msUntilDue(a) - msUntilDue(b))

    const picked: Task[] = []
    let left = pickMinutes
    let skipped = 0
    for (const task of eligible) {
      if (task.estimatedDurationMinutes <= left) {
        picked.push(task)
        left -= task.estimatedDurationMinutes
      } else {
        skipped++
      }
    }

    setPlan({
      ids: picked.map((task) => task.id),
      budget: pickMinutes,
      skipped,
      planned: picked.length,
      left,
      planStart: Date.now(),
    })
    setFocusScreen('focus')
  }

  const exitFocus = () => {
    setFocusScreen('normal')
    setPlan(null)
  }

  // Planned tasks in their fixed plan (urgency) order, filtered live against
  // the current tasks — a task missing entirely (e.g. deleted via Manage
  // while a plan was active) is dropped rather than crashing.
  const plannedTasks: Task[] = plan
    ? plan.ids
        .map((id) => tasks.find((task) => task.id === id))
        .filter((task): task is Task => task !== undefined)
    : []
  const remainingPlannedTasks = plan
    ? plannedTasks.filter((task) => !isPlannedTaskDone(task, plan))
    : []
  const remainingPlannedMinutes = remainingPlannedTasks.reduce(
    (sum, task) => sum + task.estimatedDurationMinutes,
    0,
  )

  return (
    <div className="min-h-svh bg-neutral-100 dark:bg-neutral-950">
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Cleaning Planner
          </h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setScreen('manage')}
              aria-label="Manage home"
              className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 active:bg-neutral-100 dark:text-neutral-400 dark:active:bg-neutral-800"
            >
              <Settings className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
            </button>
            {import.meta.env.DEV && (
              <button
                type="button"
                onClick={() => randomizeTaskState()}
                className="rounded-md bg-neutral-200 px-2 py-1 text-xs font-medium text-neutral-600 active:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-400"
              >
                🎲 Randomize
              </button>
            )}
          </div>
        </div>

        {hasTasks && (
          <div className="px-4 pb-3">
            {focusScreen === 'focus' && plan ? (
              <FocusBanner
                remainingCount={remainingPlannedTasks.length}
                remainingMinutes={remainingPlannedMinutes}
                plan={plan}
                onExit={exitFocus}
              />
            ) : focusScreen === 'pick' ? (
              <div className="flex h-10 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFocusScreen('normal')}
                  className="shrink-0 px-0.5 text-[13px] font-medium text-neutral-500 dark:text-neutral-400"
                >
                  Cancel
                </button>
                <WheelPicker values={WHEEL_VALUES} value={pickMinutes} onChange={setPickMinutes} />
                <button
                  type="button"
                  onClick={startFocus}
                  className={`flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-4 text-[13.5px] font-semibold ${FOCUS_INV}`}
                >
                  <Play className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden="true" />
                  {pickMinutes}m
                </button>
              </div>
            ) : (
              <div className="flex h-10 gap-2">
                <div className="flex h-10 flex-1 rounded-lg bg-neutral-200 p-0.5 dark:bg-neutral-800">
                  {(
                    [
                      ['urgency', 'Urgency'],
                      ['room', 'Rooms'],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => changeViewMode(mode)}
                      className={`flex flex-1 items-center justify-center rounded-md text-sm font-medium transition-colors ${
                        viewMode === mode
                          ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-950 dark:text-neutral-100'
                          : 'text-neutral-500 dark:text-neutral-400'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setFocusScreen('pick')}
                  aria-label="Give me X minutes"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-black/5 bg-neutral-200 text-neutral-500 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-400"
                >
                  <Timer className="h-[17px] w-[17px]" strokeWidth={1.8} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-md px-4 py-4">
        {!hasTasks ? (
          <p className="text-center text-sm text-neutral-400 dark:text-neutral-500">
            No tasks yet.
          </p>
        ) : focusScreen === 'focus' && plan ? (
          remainingPlannedTasks.length === 0 ? (
            <FocusEndState
              kind={plan.planned > 0 ? 'done' : 'empty'}
              planned={plan.planned}
              budget={plan.budget}
              onBack={exitFocus}
            />
          ) : (
            <>
              <div className="mb-2 px-3">
                <div className="relative h-4 text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                  <span className="absolute left-0">today</span>
                  {AXIS_TICKS.map((tick) => (
                    <span
                      key={tick.label}
                      className="absolute -translate-x-1/2"
                      style={{ left: `${tick.percent}%` }}
                    >
                      {tick.label}
                    </span>
                  ))}
                </div>
              </div>

              <ul className="space-y-3">
                {remainingPlannedTasks.map((task) => renderTask(task, true, true))}
              </ul>

              {plan.skipped > 0 ? (
                <p className="mt-3.5 text-center text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">
                  {plan.skipped} due task{plan.skipped === 1 ? '' : 's'} didn't fit in {plan.budget} min —{' '}
                  <span className="font-semibold text-neutral-500 dark:text-neutral-400">
                    still on the full list
                  </span>
                  .
                </p>
              ) : plan.left >= 5 ? (
                <p className="mt-3.5 text-center text-xs leading-relaxed text-neutral-400 dark:text-neutral-500">
                  That's everything due —{' '}
                  <span className="font-semibold text-neutral-500 dark:text-neutral-400">
                    ~{plan.left} min to spare
                  </span>
                  .
                </p>
              ) : null}
            </>
          )
        ) : (
          <>
            <div className="mb-2 px-3">
              <div className="relative h-4 text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                <span className="absolute left-0">today</span>
                {AXIS_TICKS.map((tick) => (
                  <span
                    key={tick.label}
                    className="absolute -translate-x-1/2"
                    style={{ left: `${tick.percent}%` }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>

            {viewMode === 'urgency' ? (
              <ul className="space-y-3">{sortedTasks.map((task) => renderTask(task, true))}</ul>
            ) : (
              <div className="space-y-6">
                {roomGroups.map(({ room, tasks: roomTasks }) => {
                  const RoomHeaderIcon = roomIcon(room.type)
                  return (
                    <section key={room.id}>
                      <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-neutral-500 dark:text-neutral-400">
                        <RoomHeaderIcon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
                        {room.name}
                      </h2>
                      <ul className="space-y-3">
                        {roomTasks.map((task) => renderTask(task, false))}
                      </ul>
                    </section>
                  )
                })}
              </div>
            )}
          </>
        )}
      </main>

      {undoSheetTask && (
        <UndoSheet
          task={undoSheetTask}
          canRedo={undoSheetCanRedo}
          onUndo={() => void handleUndoCompletion()}
          onRedo={() => void handleRedoCompletion()}
          onCancel={() => setUndoSheetTaskId(null)}
        />
      )}
    </div>
  )
}

export default App
