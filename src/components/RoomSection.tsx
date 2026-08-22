import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { urgencyBand, type Task, type Room } from '../lib/db'
import { roomIcon } from '../lib/icons'
import { STATUS_ICON, STATUS_COLOR } from './wizard-shared'

const COLLAPSED_ROOMS_KEY = 'cp.collapsedRooms'

function loadCollapsedRoomIds(): Set<number> {
  try {
    const raw = localStorage.getItem(COLLAPSED_ROOMS_KEY)
    const ids: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(ids) ? ids : [])
  } catch {
    return new Set()
  }
}

function saveCollapsedRoomIds(ids: Set<number>): void {
  try {
    localStorage.setItem(COLLAPSED_ROOMS_KEY, JSON.stringify([...ids]))
  } catch {
    // localStorage unavailable (e.g. private mode) — the choice just won't persist.
  }
}

/**
 * The collapsed header's compact summary — task count plus whichever urgency
 * band is worst among the room's tasks (overdue > due soon > fresh), reusing
 * the wizard's own state-chip icon/color for that band so it reads
 * consistently with the rest of the app.
 */
function summarizeRoom(tasks: Task[]) {
  const overdueCount = tasks.filter((t) => urgencyBand(t) === 'overdue').length
  const soonCount = tasks.filter((t) => urgencyBand(t) === 'soon').length
  const taskWord = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`

  if (overdueCount > 0) {
    return { icon: STATUS_ICON.overdue, color: STATUS_COLOR.overdue, label: `${taskWord} · ${overdueCount} overdue` }
  }
  if (soonCount > 0) {
    return { icon: STATUS_ICON.soon, color: STATUS_COLOR.soon, label: `${taskWord} · ${soonCount} due soon` }
  }
  return { icon: STATUS_ICON.fresh, color: STATUS_COLOR.fresh, label: `${taskWord} · all fresh` }
}

/**
 * Rooms view's collapsible per-room section: a tap-to-toggle header (room
 * icon, name, and — only while collapsed — the compact urgency summary from
 * summarizeRoom) above the room's task list. Collapsed state persists per
 * room id in localStorage (cp.collapsedRooms), defaulting to expanded;
 * toggling is instant, no expand/collapse animation, matching the rest of
 * the app. `renderTask` is the caller's existing per-task renderer (already
 * wired for FLIP/long-press/active state) — this component only decides
 * whether to render the list at all.
 */
export function RoomSection({
  room,
  tasks,
  renderTask,
}: {
  room: Room
  tasks: Task[]
  renderTask: (task: Task) => ReactNode
}) {
  const [collapsed, setCollapsed] = useState(() => loadCollapsedRoomIds().has(room.id))
  const RoomHeaderIcon = roomIcon(room.type)
  const ChevronIcon = collapsed ? ChevronRight : ChevronDown
  const summary = collapsed ? summarizeRoom(tasks) : null
  const SummaryIcon = summary?.icon

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev
      const ids = loadCollapsedRoomIds()
      if (next) ids.add(room.id)
      else ids.delete(room.id)
      saveCollapsedRoomIds(ids)
      return next
    })
  }

  return (
    <section>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="mb-2 flex w-full items-center gap-2 px-1 text-left"
      >
        <RoomHeaderIcon className="h-4 w-4 shrink-0 text-neutral-500 dark:text-neutral-400" strokeWidth={2} aria-hidden="true" />
        <span className="flex-1 truncate text-sm font-semibold text-neutral-500 dark:text-neutral-400">{room.name}</span>
        {summary && SummaryIcon && (
          <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-neutral-400 dark:text-neutral-500">
            <SummaryIcon className="h-3.5 w-3.5" style={{ color: summary.color }} aria-hidden="true" />
            {summary.label}
          </span>
        )}
        <ChevronIcon className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} aria-hidden="true" />
      </button>
      {!collapsed && <ul className="space-y-3">{tasks.map((task) => renderTask(task))}</ul>}
    </section>
  )
}
