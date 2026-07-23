import Dexie, { type EntityTable } from 'dexie'

export type RoomType = 'bedroom' | 'bathroom' | 'kitchen' | 'living-room' | 'other'

export interface Room {
  id: number
  name: string
  type: RoomType
}

export interface Task {
  id: number
  roomId: number
  name: string
  /** How often this task should be done, in days. */
  frequencyDays: number
  /** Rolling estimate of how long this task takes, in minutes. */
  estimatedDurationMinutes: number
  /** Epoch ms of the last time this task was completed, or null if never. */
  lastCompletedDate: number | null
}

export interface CompletionLog {
  id: number
  taskId: number
  /** Epoch ms of when the task was completed. */
  completedDate: number
  /** Actual time it took, in minutes. Omitted if not tracked for this completion. */
  actualDurationMinutes?: number
}

class CleaningPlannerDB extends Dexie {
  rooms!: EntityTable<Room, 'id'>
  tasks!: EntityTable<Task, 'id'>
  completionLogs!: EntityTable<CompletionLog, 'id'>

  constructor() {
    super('cleaning-planner')
    this.version(1).stores({
      rooms: '++id, type',
      tasks: '++id, roomId, lastCompletedDate',
      completionLogs: '++id, taskId, completedDate',
    })
  }
}

export const db = new CleaningPlannerDB()

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** How close a task is to being due, as a percent (0-100). Over 100 means overdue. */
export function percentDue(task: Task, now: Date = new Date()): number {
  if (task.lastCompletedDate === null) return 100

  const daysSinceCompleted = (now.getTime() - task.lastCompletedDate) / MS_PER_DAY
  return (daysSinceCompleted / task.frequencyDays) * 100
}

export function isOverdue(task: Task, now: Date = new Date()): boolean {
  return percentDue(task, now) >= 100
}

/**
 * Milliseconds until this task is next due. Positive = time still remaining,
 * negative = overdue by that amount. A never-completed task counts as due now (0).
 */
export function msUntilDue(task: Task, now: Date = new Date()): number {
  if (task.lastCompletedDate === null) return 0
  const dueAt = task.lastCompletedDate + task.frequencyDays * MS_PER_DAY
  return dueAt - now.getTime()
}

/**
 * A short human label for a task's due status in whole days, e.g. "Due in 3
 * days", "Due today", or "Overdue by 2 days". Cleaning cadence is measured in
 * days, so anything under half a day either way reads as "Due today".
 */
export function formatTimeUntilDue(task: Task, now: Date = new Date()): string {
  const ms = msUntilDue(task, now)
  const days = Math.round(Math.abs(ms) / MS_PER_DAY)

  if (days === 0) return 'Due today'

  const label = `${days} day${days === 1 ? '' : 's'}`
  return ms >= 0 ? `Due in ${label}` : `Overdue by ${label}`
}

/**
 * A compact overdue label for the badge in whole days, e.g. "2d". Returns an
 * empty string when the task isn't overdue by at least a day (including a
 * never-completed task, which is due-today rather than overdue-by-some-time).
 */
export function formatOverdueShort(task: Task, now: Date = new Date()): string {
  const ms = msUntilDue(task, now)
  if (ms >= 0) return ''

  const days = Math.round(Math.abs(ms) / MS_PER_DAY)
  return days >= 1 ? `${days}d` : ''
}

/**
 * Recalculates a task's estimatedDurationMinutes as the rolling average of its
 * last 5 completion logs that have a tracked duration. Falls back to (i.e.
 * leaves unchanged) the current estimate if there's no such history yet.
 */
export async function recalculateEstimatedDuration(taskId: number): Promise<number> {
  const task = await db.tasks.get(taskId)
  if (!task) throw new Error(`Task ${taskId} not found`)

  const logs = await db.completionLogs.where('taskId').equals(taskId).toArray()

  const recentDurations = logs
    .filter((log) => log.actualDurationMinutes !== undefined)
    .sort((a, b) => b.completedDate - a.completedDate)
    .slice(0, 5)
    .map((log) => log.actualDurationMinutes!)

  if (recentDurations.length === 0) return task.estimatedDurationMinutes

  const average = Math.round(
    recentDurations.reduce((sum, minutes) => sum + minutes, 0) / recentDurations.length,
  )

  await db.tasks.update(taskId, { estimatedDurationMinutes: average })
  return average
}

/**
 * Marks a task as completed: inserts a CompletionLog entry and updates the
 * task's lastCompletedDate, then refreshes its estimatedDurationMinutes.
 */
export async function logCompletion(
  taskId: number,
  options: { completedDate?: Date; actualDurationMinutes?: number } = {},
): Promise<void> {
  const completedDate = (options.completedDate ?? new Date()).getTime()

  await db.transaction('rw', db.tasks, db.completionLogs, async () => {
    await db.completionLogs.add({
      taskId,
      completedDate,
      actualDurationMinutes: options.actualDurationMinutes,
    } as CompletionLog)

    await db.tasks.update(taskId, { lastCompletedDate: completedDate })
    await recalculateEstimatedDuration(taskId)
  })
}

/** An emoji icon for a room, chosen by its type. */
export function roomIcon(type: RoomType): string {
  switch (type) {
    case 'bedroom':
      return '🛏️'
    case 'bathroom':
      return '🚿'
    case 'kitchen':
      return '🍳'
    case 'living-room':
      return '🛋️'
    default:
      return '🏠'
  }
}

/**
 * An emoji icon inferred from a task's name by keyword — e.g. a feather duster
 * for "Dust". Falls back to a generic sponge so custom/unknown tasks still get
 * an icon. First match wins, so order the more specific keywords first.
 */
export function taskIcon(name: string): string {
  const n = name.toLowerCase()
  if (n.includes('dust')) return '🪶'
  if (n.includes('vacuum') || n.includes('sweep')) return '🧹'
  if (n.includes('mop') || n.includes('floor')) return '🪣'
  if (n.includes('sheet') || n.includes('bed') || n.includes('linen')) return '🛏️'
  if (n.includes('window') || n.includes('glass') || n.includes('mirror')) return '🪟'
  if (n.includes('bath') || n.includes('shower') || n.includes('toilet') || n.includes('sink'))
    return '🚿'
  if (n.includes('microwave') || n.includes('oven') || n.includes('fridge') || n.includes('dish'))
    return '🍽️'
  if (n.includes('trash') || n.includes('garbage') || n.includes('bin')) return '🗑️'
  if (n.includes('laundry') || n.includes('wash')) return '🧺'
  if (n.includes('counter') || n.includes('surface') || n.includes('wipe')) return '🧽'
  return '🧽'
}

/**
 * DEV-ONLY: scatters every task's lastCompletedDate across a range so the UI
 * shows a mix of fresh, near-due, and overdue states. Each task is set to a
 * random 0–1.7× of its own frequency ago, so percentDue lands roughly in
 * 0–170% — giving overdue-by amounts from minutes (daily tasks) to weeks.
 */
export async function randomizeTaskState(): Promise<void> {
  const now = Date.now()
  const tasks = await db.tasks.toArray()

  await db.transaction('rw', db.tasks, async () => {
    for (const task of tasks) {
      const elapsedDays = Math.random() * 1.7 * task.frequencyDays
      const lastCompletedDate = Math.round(now - elapsedDays * MS_PER_DAY)
      await db.tasks.update(task.id, { lastCompletedDate })
    }
  })
}

interface SeedTask {
  name: string
  roomType: RoomType
  frequencyDays: number
  estimatedDurationMinutes: number
}

const DEFAULT_ROOMS: Array<{ name: string; type: RoomType }> = [
  { name: 'Bedroom', type: 'bedroom' },
  { name: 'Bathroom', type: 'bathroom' },
  { name: 'Kitchen', type: 'kitchen' },
  { name: 'Living Room', type: 'living-room' },
]

// Frequencies and durations are rough, research-backed household defaults —
// meant as a reasonable starting point, adjusted per-task once real
// completion data comes in via recalculateEstimatedDuration.
const DEFAULT_TASKS: SeedTask[] = [
  { name: 'Vacuum', roomType: 'living-room', frequencyDays: 7, estimatedDurationMinutes: 15 },
  { name: 'Mop floors', roomType: 'kitchen', frequencyDays: 7, estimatedDurationMinutes: 15 },
  { name: 'Dust', roomType: 'living-room', frequencyDays: 30, estimatedDurationMinutes: 10 },
  { name: 'Change sheets', roomType: 'bedroom', frequencyDays: 7, estimatedDurationMinutes: 10 },
  { name: 'Clean bathroom', roomType: 'bathroom', frequencyDays: 7, estimatedDurationMinutes: 20 },
  {
    name: 'Clean kitchen counters',
    roomType: 'kitchen',
    frequencyDays: 1,
    estimatedDurationMinutes: 5,
  },
  { name: 'Clean windows', roomType: 'living-room', frequencyDays: 30, estimatedDurationMinutes: 20 },
  { name: 'Clean microwave', roomType: 'kitchen', frequencyDays: 30, estimatedDurationMinutes: 5 },
]

/** Seeds a small starter set of rooms and tasks. No-ops if any rooms already exist. */
export async function seedDatabase(): Promise<void> {
  await db.transaction('rw', db.rooms, db.tasks, async () => {
    // Check inside the transaction (rather than before it) so concurrent
    // calls — e.g. React StrictMode double-invoking an effect in dev — can't
    // both pass the check before either has inserted anything.
    const existingRoomCount = await db.rooms.count()
    if (existingRoomCount > 0) return

    const roomIdByType = new Map<RoomType, number>()

    for (const room of DEFAULT_ROOMS) {
      const id = await db.rooms.add(room as Room)
      roomIdByType.set(room.type, id)
    }

    for (const task of DEFAULT_TASKS) {
      const roomId = roomIdByType.get(task.roomType)
      if (roomId === undefined) continue

      await db.tasks.add({
        roomId,
        name: task.name,
        frequencyDays: task.frequencyDays,
        estimatedDurationMinutes: task.estimatedDurationMinutes,
        lastCompletedDate: null,
      } as Task)
    }
  })
}
