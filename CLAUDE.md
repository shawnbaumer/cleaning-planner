# Cleaning Planner

## Purpose

A personal iPhone cleaning-planner PWA. Helps track and schedule household
cleaning tasks. Installable to the iPhone home screen, works offline, and
stores all data locally on-device — no backend, no account, no sync.

## Vision

Tasks are organized by room. Each task has a target frequency (e.g. every 7
days), and its urgency is shown as a progress bar: 0% means just completed,
100% means due now, and past 100% means overdue — so at a glance you can see
what most needs attention.

Duration estimates start from reasonable defaults but adapt over time: every
time a task is logged as done, its actual duration feeds into a rolling
average that updates `estimatedDurationMinutes`, so the app's time estimates
get more accurate the more it's used.

A future feature: "give me X minutes" — tell the app how much time you have,
and it suggests which task(s) to knock out, favoring what's most overdue
and what fits the time available.

## Tech stack

- **Vite** — build tool / dev server
- **React 19** + **TypeScript** — UI
- **Tailwind CSS v4** (`@tailwindcss/vite`) — styling
- **vite-plugin-pwa** — service worker + web app manifest for installability
  and offline support
- **Dexie** — wrapper around IndexedDB for local data persistence
- **dexie-react-hooks** — `useLiveQuery`, keeps the UI in sync with IndexedDB
  changes without manual refetching
- **lucide-react** — monochrome line-icon set for task/room icons (stroke uses
  `currentColor`, so icons inherit text color and adapt to dark mode)

## Folder structure

```
├── public/              Static assets served as-is (favicon, etc.)
├── src/
│   ├── lib/
│   │   ├── db.ts        Dexie database instance (IndexedDB schema lives here)
│   │   └── icons.tsx    Keyword→Lucide icon mapping (taskIcon, roomIcon)
│   ├── App.tsx           Root component
│   ├── main.tsx          React entry point / DOM mount
│   └── index.css         Tailwind entry point
├── index.html            Vite HTML entry
├── vite.config.ts         Vite config: React, Tailwind, and PWA plugins
└── package.json
```

## Data model

Defined in `src/lib/db.ts` as three Dexie (IndexedDB) tables:

- **Room** — `id`, `name`, `type` (`bedroom` | `bathroom` | `kitchen` |
  `living-room` | `other`)
- **Task** — `id`, `roomId`, `name`, `frequencyDays` (target interval between
  completions), `estimatedDurationMinutes` (adaptive estimate),
  `lastCompletedDate` (epoch ms, or `null` if never completed)
- **CompletionLog** — `id`, `taskId`, `completedDate` (epoch ms),
  `actualDurationMinutes` (optional — omitted if not tracked for that
  completion)

### Helper functions (`src/lib/db.ts`)

- `percentDue(task, now?)` — how close a task is to due, as a percent
  (0-100+; 100+ means overdue)
- `isOverdue(task, now?)` — `percentDue(task) >= 100`
- `logCompletion(taskId, { completedDate?, actualDurationMinutes? })` —
  inserts a `CompletionLog` row, updates the task's `lastCompletedDate`, and
  refreshes its `estimatedDurationMinutes`
- `recalculateEstimatedDuration(taskId)` — recomputes
  `estimatedDurationMinutes` as the average of the task's last 5 logged
  durations, falling back to (leaving unchanged) the current estimate if
  there's no duration history yet
- `formatTimeUntilDue(task)` / `formatOverdueShort(task)` — long/short due
  labels in whole days ("Due in 3 days", "2d"). Currently unused by the UI
  (kept for reuse); the card uses `formatDueShort` instead
- `formatDueShort(task)` — compact due-status for the card's title row: "2d
  over" (overdue), "Today" (due now / never completed), or "3d" (upcoming)

Task and room icons live in `src/lib/icons.tsx` (not `db.ts`): `taskIcon(name)`
returns a keyword-inferred Lucide component, `roomIcon(type)` returns one per
room type. Both are monochrome and inherit text color.
- `seedDatabase()` — populates a starter set of rooms and common tasks with
  research-backed default frequencies/durations; no-ops if any room already
  exists

## Product direction (beyond current build)

Decisions made in planning that aren't built yet, kept here so they aren't
lost between sessions:

- **Design principle:** minimize time spent in the app itself — the point is
  to spend time cleaning, not navigating a phone. Competitor research (Tody,
  HomeRoutine, Spotless, OurHome, etc.) informed this: adopt Tody's glanceable
  color-coded urgency and HomeRoutine's "focused time-boxed session" idea;
  explicitly reject gamification (points, streaks, leaderboards, allowance
  systems) as adding engagement overhead rather than speed.
- **Milestone B — setup wizard:** instead of adding tasks one by one, let the
  user pick their rooms (and quantity of each) plus a few toggles (has pets,
  has plants, etc.), and auto-generate a starter task list from a built-in
  suggestion library seeded with researched default frequencies/durations
  (see `seedDatabase()` for the current starter set). Still fully editable
  afterward.
- **Milestone C — "give me X minutes":** user enters a time budget; the app
  sorts due/overdue tasks by urgency and greedily fills the time budget using
  `estimatedDurationMinutes`, surfacing which task(s) to do right now. No new
  data-model fields needed — this reads directly off `percentDue` and
  `estimatedDurationMinutes`, both already implemented.
- **Milestone D (later/optional):** push notifications/reminders, per-plant
  or per-furniture task customization, multi-device sync, sharing with
  roommates.

## Status

Single-screen UI built on top of the data layer (`src/App.tsx`). A header
**segmented toggle switches between two main views** (`viewMode`, persisted to
`localStorage` under `cleaning-planner:viewMode`, defaulting to Urgency):

- **Urgency (default)** — a single flat list of every task sorted most-urgent
  first by `percentDue`, with a subtle room label under each task name for
  context. Truest to the glanceable-urgency design principle: the most overdue
  task in the whole apartment is always at the very top.
- **Rooms** — tasks **grouped by room** under a header with a room-type icon
  (`roomIcon`); rooms are ordered by their most-urgent task and tasks within a
  room are sorted most-urgent first. For batch-cleaning one room at a time.

Both views render identical **compact task cards** via a shared
`renderTask(task, showRoomLabel)` helper (the room label shows only in Urgency
view; the Rooms view's header already provides that context). Each card is a
tight layout: a monochrome Lucide task icon + name on the left, a right-aligned
compact due status (`formatDueShort`: "2d over" / "Today" / "3d") colored by
urgency (neutral → amber ≥75% → red overdue), and a thin `percentDue` progress
bar (blue → amber ≥75% → red once overdue) below. In Urgency view a small muted
room label (Lucide room icon + name) sits under the task name. "Mark done"
reveals a row of duration chips (5/10/15/20/30 min, plus the task's current
estimate) with the estimate pre-selected — confirming is one tap.

Dev helpers in `db.ts`: `randomizeTaskState()` scatters completion dates for
testing, surfaced as a DEV-only 🎲 Randomize button in the header (hidden in
production via `import.meta.env.DEV`).

No add/edit-task screen or navigation yet — this is the biggest remaining gap
in the "basics" (the app is read-only beyond marking done). Note: task icons are
inferred from the name rather than stored — an explicit per-task icon field may
be worth adding once custom tasks exist. Next up (still open): add/edit/delete
tasks (CRUD), then the "give me X minutes" suggestion feature (Milestone C).

## Commands

- `npm run dev` — start dev server
- `npm run build` — type-check and build for production
- `npm run preview` — preview the production build
- `npm run lint` — run oxlint
