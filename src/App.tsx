import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  seedDatabase,
  logCompletion,
  percentDue,
  formatTimeUntilDue,
  formatOverdueShort,
  roomIcon,
  taskIcon,
  randomizeTaskState,
  type Task,
} from './lib/db'

const DURATION_PRESETS = [5, 10, 15, 20, 30]

function App() {
  useEffect(() => {
    seedDatabase()
  }, [])

  const tasks = useLiveQuery(() => db.tasks.toArray())
  const rooms = useLiveQuery(() => db.rooms.toArray())

  const [expandedTaskId, setExpandedTaskId] = useState<number | null>(null)
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null)

  if (!tasks || !rooms) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-neutral-100 dark:bg-neutral-950">
        <p className="text-neutral-400 dark:text-neutral-500">Loading…</p>
      </div>
    )
  }

  // Group tasks under their room, most-urgent task first within each room, and
  // float the room containing the most-urgent task to the top — so the list
  // stays glanceable while being organized by room. Empty rooms are dropped.
  const roomGroups = rooms
    .map((room) => ({
      room,
      tasks: tasks
        .filter((task) => task.roomId === room.id)
        .sort((a, b) => percentDue(b) - percentDue(a)),
    }))
    .filter((group) => group.tasks.length > 0)
    .sort((a, b) => percentDue(b.tasks[0]) - percentDue(a.tasks[0]))

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

  return (
    <div className="min-h-svh bg-neutral-100 dark:bg-neutral-950">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90">
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
      </header>

      <main className="mx-auto max-w-md px-4 py-4">
        {roomGroups.length === 0 ? (
          <p className="text-center text-sm text-neutral-400 dark:text-neutral-500">
            No tasks yet.
          </p>
        ) : (
          <div className="space-y-6">
            {roomGroups.map(({ room, tasks: roomTasks }) => (
              <section key={room.id}>
                <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-neutral-500 dark:text-neutral-400">
                  <span className="text-base leading-none">{roomIcon(room.type)}</span>
                  {room.name}
                </h2>
                <ul className="space-y-3">
                  {roomTasks.map((task) => {
                    const percent = percentDue(task)
                    const overdue = percent >= 100
                    const isExpanded = expandedTaskId === task.id
                    const durationOptions = [
                      ...new Set([...DURATION_PRESETS, task.estimatedDurationMinutes]),
                    ].sort((a, b) => a - b)

                    return (
                      <li
                        key={task.id}
                        className="rounded-xl bg-white p-4 shadow-sm dark:bg-neutral-900"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-xl leading-none">{taskIcon(task.name)}</span>
                            <p className="truncate text-base font-medium text-neutral-900 dark:text-neutral-100">
                              {task.name}
                            </p>
                          </div>
                          {overdue && (
                            <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600 dark:bg-red-950 dark:text-red-400">
                              {formatOverdueShort(task)
                                ? `Overdue · ${formatOverdueShort(task)}`
                                : 'Overdue'}
                            </span>
                          )}
                        </div>

                        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
                          <div
                            className={`h-full rounded-full transition-all ${
                              overdue
                                ? 'bg-red-500'
                                : percent >= 75
                                  ? 'bg-amber-500'
                                  : 'bg-blue-500'
                            }`}
                            style={{ width: `${Math.min(percent, 100)}%` }}
                          />
                        </div>

                        <p
                          className={`mt-1.5 text-xs font-medium ${
                            overdue
                              ? 'text-red-600 dark:text-red-400'
                              : percent >= 75
                                ? 'text-amber-600 dark:text-amber-500'
                                : 'text-neutral-500 dark:text-neutral-400'
                          }`}
                        >
                          {formatTimeUntilDue(task)}
                        </p>

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
                                  {minutes} min
                                  {minutes === task.estimatedDurationMinutes ? ' •' : ''}
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
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

export default App
