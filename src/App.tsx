import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, seedDatabase, logCompletion, percentDue, type Task } from './lib/db'

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

  const roomNameById = new Map(rooms.map((room) => [room.id, room.name]))
  const sortedTasks = [...tasks].sort((a, b) => percentDue(b) - percentDue(a))

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
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Cleaning Planner
        </h1>
      </header>

      <main className="mx-auto max-w-md px-4 py-4">
        {sortedTasks.length === 0 ? (
          <p className="text-center text-sm text-neutral-400 dark:text-neutral-500">
            No tasks yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {sortedTasks.map((task) => {
              const percent = percentDue(task)
              const overdue = percent >= 100
              const roomName = roomNameById.get(task.roomId) ?? 'Unknown room'
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
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                        {roomName}
                      </p>
                      <p className="truncate text-base font-medium text-neutral-900 dark:text-neutral-100">
                        {task.name}
                      </p>
                    </div>
                    {overdue && (
                      <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600 dark:bg-red-950 dark:text-red-400">
                        Overdue
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
        )}
      </main>
    </div>
  )
}

export default App
