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

## Folder structure

```
├── public/              Static assets served as-is (favicon, etc.)
├── src/
│   ├── lib/
│   │   └── db.ts        Dexie database instance (IndexedDB schema lives here)
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
- `seedDatabase()` — populates a starter set of rooms and common tasks with
  research-backed default frequencies/durations; no-ops if any room already
  exists

## Status

Single-screen UI built on top of the data layer (`src/App.tsx`): seeds the
database on first load, lists all tasks sorted most-urgent first, shows each
task's room, name, and a `percentDue` progress bar (red past 100%/overdue).
"Mark done" reveals a row of duration chips (5/10/15/20/30 min, plus the
task's current estimate) with the estimate pre-selected — confirming with
that default is one tap; picking another chip first still only takes one
more. No add/edit-task screen or navigation yet. Next up: the "give me X
minutes" suggestion feature.

## Commands

- `npm run dev` — start dev server
- `npm run build` — type-check and build for production
- `npm run preview` — preview the production build
- `npm run lint` — run oxlint
