import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  seedDatabase,
  logCompletion,
  msUntilDue,
  duePosition,
  urgencyBand,
  axisFrac,
  formatDueShort,
  randomizeTaskState,
  type Task,
  type Room,
} from './lib/db'
import { roomIcon, taskIcon } from './lib/icons'

const DURATION_PRESETS = [5, 10, 15, 20, 30]

// Shared due-time axis ticks, positioned with the same axisFrac used by every
// task's bar so the legend lines up with the bars underneath it.
const AXIS_TICKS = [
  { label: '1d', frac: axisFrac(1) },
  { label: '1w', frac: axisFrac(7) },
  { label: '2w', frac: axisFrac(14) },
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

function App() {
  useEffect(() => {
    seedDatabase()
  }, [])

  const tasks = useLiveQuery(() => db.tasks.toArray())
  const rooms = useLiveQuery(() => db.rooms.toArray())

  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null)
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null)
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
  // Sorted by msUntilDue (most overdue → soonest due → furthest out) so list
  // order always matches left-to-right position on the due-time axis bars.
  const sortedTasks = [...tasks].sort((a, b) => msUntilDue(a) - msUntilDue(b))

  // Group tasks under their room, most-urgent task first within each room, and
  // float the room containing the most-urgent task to the top — so the list
  // stays glanceable while being organized by room. Empty rooms are dropped.
  const roomGroups = rooms
    .map((room) => ({
      room,
      tasks: tasks
        .filter((task) => task.roomId === room.id)
        .sort((a, b) => msUntilDue(a) - msUntilDue(b)),
    }))
    .filter((group) => group.tasks.length > 0)
    .sort((a, b) => msUntilDue(a.tasks[0]) - msUntilDue(b.tasks[0]))

  const handleMarkDone = (task: Task) => {
    setExpandedTaskId(task.id)
    setSelectedDuration(task.estimatedDurationMinutes)
  }

  const handleCancel = () => {
    setExpandedTaskId(null)
    setSelectedDuration(null)
  }

  const handleConfirm = async (task: Task) => {
    await logCompletion(task.id, {
      actualDurationMinutes: selectedDuration ?? task.estimatedDurationMinutes,
    })
    setExpandedTaskId(null)
    setSelectedDuration(null)
  }

  // Renders a single task card. In the flat urgency view we show a subtle room
  // label (there's no room header to provide that context); in the grouped
  // view the room header already covers it, so it's omitted.
  const renderTask = (task: Task, showRoomLabel: boolean) => {
    const band = urgencyBand(task)
    const overdue = band === 'overdue'
    const pos = duePosition(task) * 100
    const isExpanded = expandedTaskId === task.id
    const room = roomsById.get(task.roomId)
    const Icon = taskIcon(task.name)
    const RoomLabelIcon = room ? roomIcon(room.type) : null
    const durationOptions = [
      ...new Set([...DURATION_PRESETS, task.estimatedDurationMinutes]),
    ].sort((a, b) => a - b)

    const statusColor =
      band === 'overdue'
        ? 'text-red-600 dark:text-red-400'
        : band === 'soon'
          ? 'text-amber-600 dark:text-amber-500'
          : 'text-neutral-400 dark:text-neutral-500'

    const cardTint =
      band === 'overdue'
        ? 'bg-red-50 dark:bg-red-950/40'
        : band === 'soon'
          ? 'bg-amber-50 dark:bg-amber-950/40'
          : 'bg-green-50 dark:bg-green-950/30'

    return (
      <li key={task.id} className={`rounded-xl p-3 shadow-sm ${cardTint}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Icon
              className="h-5 w-5 shrink-0 text-neutral-500 dark:text-neutral-400"
              strokeWidth={2}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-medium text-neutral-900 dark:text-neutral-100">
                {task.name}
              </p>
              {showRoomLabel && room && RoomLabelIcon && (
                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-neutral-400 dark:text-neutral-500">
                  <RoomLabelIcon className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden="true" />
                  {room.name}
                </p>
              )}
            </div>
          </div>
          <span className={`shrink-0 text-xs font-semibold ${statusColor}`}>
            {formatDueShort(task)}
          </span>
        </div>

        <div className="relative mt-2.5 h-2 w-full rounded-full bg-neutral-200/80 dark:bg-neutral-800/80">
          <div className="absolute inset-y-0 left-0 w-px bg-neutral-400 dark:bg-neutral-600" />
          {AXIS_TICKS.map((tick) => (
            <div
              key={tick.label}
              className="absolute inset-y-0 w-px bg-neutral-300 dark:bg-neutral-700"
              style={{ left: `${tick.frac * 100}%` }}
            />
          ))}
          {!overdue && (
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-neutral-400/60 dark:bg-neutral-500/50"
              style={{ width: `${pos}%` }}
            />
          )}
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-neutral-700 dark:border-neutral-900 dark:bg-neutral-200"
            style={{ left: `${overdue ? 0 : pos}%` }}
          />
        </div>

        {!isExpanded ? (
          <button
            type="button"
            onClick={() => handleMarkDone(task)}
            className="mt-3 w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white active:bg-blue-700"
          >
            Mark done
          </button>
        ) : (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              {durationOptions.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => setSelectedDuration(minutes)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                    selectedDuration === minutes
                      ? 'bg-blue-600 text-white'
                      : 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
                  }`}
                >
                  {minutes} min{minutes === task.estimatedDurationMinutes ? ' •' : ''}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleConfirm(task)}
                className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-semibold text-white active:bg-green-700"
              >
                Confirm ({selectedDuration} min)
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-lg bg-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-700 active:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </li>
    )
  }

  const hasTasks = tasks.length > 0

  return (
    <div className="min-h-svh bg-neutral-100 dark:bg-neutral-950">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90">
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
                    style={{ left: `${tick.frac * 100}%` }}
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
