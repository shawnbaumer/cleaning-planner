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

// A shared log-scale time axis used to position every task's due-position and
// drop geometry on the same timeline, in SVG viewBox units ("0 0 200 20") —
// so every task's bar is directly comparable regardless of frequencyDays.
// Today = 0, and 2 weeks out lands at 90% of the axis, log-scaled so
// short-term differences (a day or two) stay visually spread out while
// far-future dates compress toward the right edge.
export const X0 = 6.5 // today / left-cap center
export const X_RIGHT = 197.25 // axis right edge
const AXIS_D = Math.log(15) / 0.9

/**
 * Maps a number of days from now to a 0-1 fraction on the shared log-time
 * axis: 0 = today (or already past), approaching 1 the further out. Days
 * <= 0 are pinned to 0 rather than going negative, since the axis only
 * represents time still to come.
 */
export function axisFrac(days: number): number {
  return days <= 0 ? 0 : Math.min(1, Math.log(1 + days) / AXIS_D)
}

/** Maps a 0-1 axis fraction to an x-coordinate in viewBox units. */
export const axisX = (frac: number): number => X0 + frac * (X_RIGHT - X0)

/**
 * The outline path for a task's "drop" bar: widest at today, gentle
 * half-strength log taper to a thin rounded tip at the task's own cycle
 * length (frequencyDays), with rounded caps at both ends. A daily task is a
 * short stub; a monthly one runs long — the drop's length encodes the
 * task's own cadence, decoupled from how soon it's actually due.
 */
export function hornPath(cycleDays: number): string {
  const H = 13
  const k = 1.5
  const cy = 10
  const xMax = X_RIGHT
  const R = H / 2
  const N = 46
  const xEnd = axisX(axisFrac(cycleDays))
  const h = (x: number) => H * Math.exp((-k * (x - X0)) / (xMax - X0))
  const rr = Math.max(1.1, h(xEnd) / 2)
  const xB = xEnd - rr
  const xs = Array.from({ length: N + 1 }, (_, i) => X0 + (xB - X0) * (i / N))

  let d = `M ${X0.toFixed(1)} ${(cy - H / 2).toFixed(2)}`
  for (const x of xs) d += ` L ${x.toFixed(1)} ${(cy - h(x) / 2).toFixed(2)}`
  d += ` A ${rr.toFixed(2)} ${rr.toFixed(2)} 0 0 1 ${xB.toFixed(1)} ${(cy + h(xB) / 2).toFixed(2)}`
  for (let i = xs.length - 1; i >= 0; i--)
    d += ` L ${xs[i].toFixed(1)} ${(cy + h(xs[i]) / 2).toFixed(2)}`
  d += ` A ${R} ${R} 0 0 1 ${X0.toFixed(1)} ${(cy - H / 2).toFixed(2)} Z`
  return d
}

/**
 * The left edge (viewBox x) of the time-until-due fill on a task's drop:
 * pinned to 0 (the viewBox's left edge) once due/overdue — not X0 — because
 * the drop's rounded left cap bulges out to x = X0 - H/2 = 0 (see hornPath),
 * so anything short of the true viewBox edge clips off part of the cap and
 * leaves a sliver unfilled even when the task is "fully" due. Moves right
 * the further out the due date is. Clipping the drop path to
 * [fillStartX, viewBox right edge] fills from today up to the due date.
 */
export function fillStartX(task: Task, now: Date = new Date()): number {
  const daysUntilDue = msUntilDue(task, now) / MS_PER_DAY
  if (daysUntilDue <= 0) return 0
  return axisX(axisFrac(daysUntilDue))
}

// Cycle-state color stops: green (just completed) -> yellow (approaching
// due) -> red (overdue). Kept as raw RGB tuples so cycleColor/outlineColor
// can interpolate between them.
const GREEN = [94, 160, 46]
const YELLOW = [224, 165, 0]
const RED = [226, 75, 74]
const toHex = (c: number[]) =>
  '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t)

/** A task's cycle-state color: green -> yellow across the cycle, red once overdue. */
export function cycleColor(task: Task, now: Date = new Date()): string {
  const pd = percentDue(task, now)
  if (pd >= 100) return toHex(RED)
  return toHex(mix(GREEN, YELLOW, pd / 100))
}

/**
 * A darker shade of cycleColor for the drop's outline, so the outline reads
 * as "freshness" even when the time-until-due fill is empty (task is due
 * far out, so the fill is a thin sliver near today).
 */
export function outlineColor(task: Task, now: Date = new Date()): string {
  const pd = percentDue(task, now)
  const base = pd >= 100 ? RED : mix(GREEN, YELLOW, pd / 100)
  return toHex(mix(base, [0, 0, 0], 0.22))
}

/** True once a task is overdue by more than a whole cycle again (>= 200%). */
export function severeOverdue(task: Task, now: Date = new Date()): boolean {
  return percentDue(task, now) >= 200
}

export type UrgencyBand = 'fresh' | 'soon' | 'overdue'

/** Which urgency band a task falls in, derived from percentDue. */
export function urgencyBand(task: Task, now: Date = new Date()): UrgencyBand {
  const percent = percentDue(task, now)
  if (percent >= 100) return 'overdue'
  if (percent >= 75) return 'soon'
  return 'fresh'
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

/**
 * A compact due-status label for the card's title row in whole days, e.g.
 * "2d over" (overdue), "Today" (due now / within half a day either way), or
 * "3d" (upcoming). Pairs with an urgency color chosen by the caller from
 * urgencyBand/percentDue.
 */
export function formatDueShort(task: Task, now: Date = new Date()): string {
  const ms = msUntilDue(task, now)
  const days = Math.round(Math.abs(ms) / MS_PER_DAY)

  if (days === 0) return 'Today'
  return ms >= 0 ? `${days}d` : `${days}d over`
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
