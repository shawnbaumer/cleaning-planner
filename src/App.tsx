import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  seedDatabase,
  logCompletion,
  msUntilDue,
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
  randomizeTaskState,
  type Task,
  type Room,
} from './lib/db'
import { roomIcon, taskIcon } from './lib/icons'

// Duration wheel values for the "Complete" path's Apple-timer-style picker —
// 5-minute increments from 5 to 90.
const WHEEL_VALUES = Array.from({ length: 18 }, (_, i) => (i + 1) * 5)

// Shared due-time axis ticks, positioned with the same axisX/axisFrac used by
// every task's bar so the legend lines up with the bars underneath it. The
// bar's SVG viewBox is "0 0 200 20", so a viewBox x maps to a % of width by
// dividing by 200.
const AXIS_TICKS = [
  { label: '1d', percent: (axisX(axisFrac(1)) / 200) * 100 },
  { label: '3d', percent: (axisX(axisFrac(3)) / 200) * 100 },
  { label: '1w', percent: (axisX(axisFrac(7)) / 200) * 100 },
  { label: '2w', percent: (axisX(axisFrac(14)) / 200) * 100 },
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

// ---------------------------------------------------------------------------
// Duration wheel (iOS-timer-style scroll picker)
// ---------------------------------------------------------------------------

const WHEEL_ITEM_H = 40
const WHEEL_VISIBLE = 5 // odd, so there's a clear centered selection row

/**
 * A vertical scroll-snap wheel of minute values, à la the iOS timer picker.
 * The centered row is the selection; scrolling changes it. Uncontrolled
 * scroll position, initialized once to `value`, then reports changes up via
 * onChange as the user scrolls/snaps.
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
  const pad = (WHEEL_VISIBLE - 1) / 2

  // Center the initial value on mount. Runs once — afterward the user drives
  // scroll position directly.
  useEffect(() => {
    const idx = Math.max(0, values.indexOf(value))
    if (ref.current) ref.current.scrollTop = idx * WHEEL_ITEM_H
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleScroll = () => {
    const el = ref.current
    if (!el) return
    const idx = Math.min(
      values.length - 1,
      Math.max(0, Math.round(el.scrollTop / WHEEL_ITEM_H)),
    )
    const next = values[idx]
    if (next !== value) onChange(next)
  }

  return (
    <div className="relative" style={{ height: WHEEL_ITEM_H * WHEEL_VISIBLE }}>
      {/* selection band behind the centered row */}
      <div
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-lg bg-neutral-100 dark:bg-neutral-800"
        style={{ height: WHEEL_ITEM_H }}
        aria-hidden="true"
      />
      <div
        ref={ref}
        onScroll={handleScroll}
        className="wheel-scroll h-full snap-y snap-mandatory overflow-y-scroll"
      >
        <div style={{ height: WHEEL_ITEM_H * pad }} />
        {values.map((v) => {
          const selected = v === value
          return (
            <div
              key={v}
              className={`flex snap-center items-center justify-center gap-1 tabular-nums transition-colors ${
                selected
                  ? 'text-xl font-semibold text-neutral-900 dark:text-neutral-100'
                  : 'text-base font-medium text-neutral-400 dark:text-neutral-600'
              }`}
              style={{ height: WHEEL_ITEM_H }}
            >
              {v}
              <span
                className={`font-normal ${selected ? 'text-sm text-neutral-500 dark:text-neutral-400' : 'text-xs text-neutral-400 dark:text-neutral-600'}`}
              >
                min
              </span>
            </div>
          )
        })}
        <div style={{ height: WHEEL_ITEM_H * pad }} />
      </div>
      {/* soft top/bottom fades so off-center values recede */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-2/5 bg-gradient-to-b from-white to-transparent dark:from-neutral-900" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-white to-transparent dark:from-neutral-900" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Task card + its completion interaction
// ---------------------------------------------------------------------------

type Interaction = 'idle' | 'prompt' | 'stopwatch' | 'wheel'
type ResetAnim = { phase: 'drain' | 'blink'; color: string; stroke: string }

const RESET_GREEN = '#22c55e'

/**
 * A single task card. Collapsed, the whole tile is a tap target. Tapping lifts
 * a panel on top of the tile offering Start (run a stopwatch) or Complete (pick
 * a duration on a wheel). Either path logs the completion and plays a reset
 * animation: the drop's time-fill drains out to the right, then its outline
 * blinks green once.
 */
function TaskCard({
  task,
  room,
  showRoomLabel,
  isActive,
  onActivate,
  onClose,
}: {
  task: Task
  room: Room | undefined
  showRoomLabel: boolean
  isActive: boolean
  onActivate: () => void
  onClose: () => void
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

  // Collapse this card's interaction if another card becomes the active one.
  // Never interrupts an in-flight reset animation (that lives in `anim`).
  useEffect(() => {
    if (!isActive) {
      setMode('idle')
      swStartRef.current = null
      setElapsedMs(0)
    }
  }, [isActive])

  // Tick the stopwatch once a second while it's running.
  useEffect(() => {
    if (mode !== 'stopwatch' || swStartRef.current === null) return
    const id = window.setInterval(() => {
      if (swStartRef.current !== null) setElapsedMs(Date.now() - swStartRef.current)
    }, 1000)
    return () => window.clearInterval(id)
  }, [mode])

  // Clean up a running rAF on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

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

  // Plays the drain-then-blink reset. Captures the drop's current fill/colors
  // *before* the DB update lands (logCompletion makes the task fresh), then
  // animates from that captured state so the fill visibly empties out.
  const playReset = () => {
    const color = cycleColor(task)
    const stroke = outlineColor(task)
    const startSx = fillStartX(task)

    setMode('idle')
    swStartRef.current = null
    setElapsedMs(0)
    onClose()

    setAnim({ phase: 'drain', color, stroke })
    setDrainX(startSx)

    const t0 = performance.now()
    const dur = 480
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / dur)
      const eased = 1 - Math.pow(1 - p, 3) // easeOutCubic
      setDrainX(startSx + (200 - startSx) * eased)
      if (p < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = null
        setAnim({ phase: 'blink', color, stroke })
        window.setTimeout(() => setAnim(null), 620)
      }
    }
    rafRef.current = requestAnimationFrame(step)
  }

  const complete = (minutes: number) => {
    playReset()
    // Fire-and-forget: the live query will refresh the card once it lands.
    void logCompletion(task.id, { actualDurationMinutes: minutes })
  }

  const finishStopwatch = () => {
    const minutesElapsed = elapsedMs / 60000
    // Store rounded to the nearest 5 minutes, never below 5.
    const stored = Math.max(5, Math.round(minutesElapsed / 5) * 5)
    complete(stored)
  }

  // --- drop bar geometry / colors -----------------------------------------
  const band = urgencyBand(task)
  const Icon = taskIcon(task.name)
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
          </div>
        </div>
        <span className={`shrink-0 text-xs font-semibold ${statusColor}`}>
          {formatDueShort(task)}
        </span>
      </div>

      <svg viewBox="0 0 200 20" width="100%" className="mt-2.5 block">
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
    <li className={`relative rounded-xl bg-white shadow-sm dark:bg-neutral-900 ${open ? 'z-30' : ''}`}>
      {/* Base tile — always rendered; blurs behind the prompt when open. */}
      <button
        type="button"
        onClick={openPrompt}
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

          {mode === 'prompt' ? (
            // Start / Complete float on top of the blurred tile.
            <div className="panel-pop absolute inset-0 z-30 flex items-center justify-center gap-2 px-3">
              <button
                type="button"
                onClick={startStopwatch}
                className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white shadow-sm active:bg-blue-700"
              >
                Start
              </button>
              <button
                type="button"
                onClick={openWheel}
                className="flex-1 rounded-lg bg-green-600 py-2.5 text-sm font-semibold text-white shadow-sm active:bg-green-700"
              >
                Complete
              </button>
            </div>
          ) : (
            // Stopwatch / wheel: a solid panel lifted on top of the tile.
            <div className="panel-pop absolute inset-x-0 top-0 z-30 rounded-xl bg-white p-3 shadow-lg ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10">
              {cardFace}

              {mode === 'stopwatch' && (
                <div className="mt-3 space-y-3">
                  <div className="flex items-center justify-center gap-2 py-1">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" aria-hidden="true" />
                    <span className="text-3xl font-bold tabular-nums text-neutral-900 dark:text-neutral-100">
                      {Math.floor(elapsedMs / 60000)}
                    </span>
                    <span className="text-base font-medium text-neutral-400 dark:text-neutral-500">
                      min
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={finishStopwatch}
                    className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-semibold text-white active:bg-green-700"
                  >
                    Done
                  </button>
                </div>
              )}

              {mode === 'wheel' && (
                <div className="mt-3 space-y-3">
                  <WheelPicker values={WHEEL_VALUES} value={wheelValue} onChange={setWheelValue} />
                  <button
                    type="button"
                    onClick={() => complete(wheelValue)}
                    className="w-full rounded-lg bg-green-600 py-2.5 text-sm font-semibold text-white active:bg-green-700"
                  >
                    Done ({wheelValue} min)
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------

function App() {
  useEffect(() => {
    seedDatabase()
  }, [])

  const tasks = useLiveQuery(() => db.tasks.toArray())
  const rooms = useLiveQuery(() => db.rooms.toArray())

  const [activeTaskId, setActiveTaskId] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode)

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

  const renderTask = (task: Task, showRoomLabel: boolean) => (
    <TaskCard
      key={task.id}
      task={task}
      room={roomsById.get(task.roomId)}
      showRoomLabel={showRoomLabel}
      isActive={activeTaskId === task.id}
      onActivate={() => setActiveTaskId(task.id)}
      onClose={() => setActiveTaskId((id) => (id === task.id ? null : id))}
    />
  )

  const hasTasks = tasks.length > 0

  return (
    <div className="min-h-svh bg-neutral-100 dark:bg-neutral-950">
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Cleaning Planner
          </h1>
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

        {hasTasks && (
          <div className="px-4 pb-3">
            <div className="flex rounded-lg bg-neutral-200 p-0.5 dark:bg-neutral-800">
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
                  className={`flex-1 rounded-md py-1.5 text-sm font-medium transition-colors ${
                    viewMode === mode
                      ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-950 dark:text-neutral-100'
                      : 'text-neutral-500 dark:text-neutral-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-md px-4 py-4">
        {!hasTasks ? (
          <p className="text-center text-sm text-neutral-400 dark:text-neutral-500">
            No tasks yet.
          </p>
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
    </div>
  )
}

export default App
