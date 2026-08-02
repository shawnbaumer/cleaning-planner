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
│   │   ├── icons.tsx    Keyword→Lucide icon mapping + name→component registry
│   │   └── library.ts   Suggestion library + task-generation for the wizard
│   ├── App.tsx           Root component (renders Wizard on first launch)
│   ├── Wizard.tsx         First-launch home setup wizard
│   ├── main.tsx          React entry point / DOM mount
│   └── index.css         Tailwind entry point
├── index.html            Vite HTML entry
├── vite.config.ts         Vite config: React, Tailwind, and PWA plugins
└── package.json
```

## Data model

Defined in `src/lib/db.ts` as four Dexie (IndexedDB) tables, currently at
schema **v2** (v1 → v2 adds `homes` and the wizard's per-room config fields;
the `upgrade()` migration attaches any pre-existing (dev) rooms to a newly
created default home and backfills the new fields with defaults):

- **Home** — `id`, `name`, `pets`, `plants`, `wfh` (booleans). The setup
  wizard creates exactly **one**, silently — there is no home-related UI
  anywhere (single implicit home; schema-ready for a future multi-home/
  sharing milestone, intentionally UI-dormant until then)
- **Room** — `id`, `homeId`, `name`, `type` (`bedroom` | `bathroom` |
  `kitchen` | `living-room` | `hallway` | `office` | `balcony` | `other`),
  `sizeClass` (`'S' | 'M' | 'L'`), `windows` (`0 | 1 | 2 | 3`, 3 = "3 or
  more"), `floor` (`'hard' | 'carpet' | 'mixed' | null`, `null` for room
  types with no floor question, e.g. balcony), `equipment` (`string[]` of
  suggestion-library equipment keys, plus free-text custom items prefixed
  `custom:`)
- **Task** — `id`, `roomId`, `name`, `frequencyDays` (target interval between
  completions), `estimatedDurationMinutes` (adaptive estimate),
  `lastCompletedDate` (epoch ms, or `null` if never completed), `icon`
  (optional Lucide icon name, e.g. `'Flame'` — resolved via
  `iconForTask`/`ICON_REGISTRY` in `icons.tsx`; falls back to `taskIcon`'s
  keyword inference when unset, which is the case for wizard free-text/
  own tasks and any legacy/dev-seeded tasks)
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
- `formatDueShort(task)` — compact due-status for the card's title row in
  whole days: "2d over" (overdue), "Today" (due now / within half a day
  either way), or "3d" (upcoming)
- `urgencyBand(task, now?)` — `'fresh' | 'soon' | 'overdue'`, derived from
  `percentDue` (< 75 / >= 75 / >= 100); drives the due-status badge color
- `axisFrac(days)` / `axisX(frac)` — the shared log-time axis used by every
  task's "drop" bar (see Status below), in the bar's `0 0 200 20` SVG
  viewBox: `axisFrac` maps a day offset to a 0-1 fraction (today = 0, 2 weeks
  ≈ 0.9, log-scaled so near-term differences stay spread out); `axisX` maps
  that fraction to a viewBox x-coordinate
- `hornPath(cycleDays)` — the SVG outline path for a task's drop: widest at
  today, log-tapered to a thin rounded tip at `cycleDays` out on the shared
  axis, rounded caps at both ends. Length encodes the task's own cadence
  (`frequencyDays`), independent of how soon it's actually due
- `notchTicks(cycleDays)` — positions for the drop's built-in day ruler: for
  each ruler day (1–7) that lands on the drop's straight body (not its tapered
  tip), returns the viewBox `x`, the drop's `half`-height there (so a tick can
  be centered on the top/bottom outline, straddling the drop line), and a
  `fade` weight (1 at today → 0 by a week) the card uses to scale each notch's
  length, stroke width, and opacity — bold near today, invisible by ~1 week.
  Shares `hornPath`'s geometry. A daily task gets none; a weekly one gets 1–6d
  (7d is its tip); a monthly one gets the full 1–7d fade
- `fillStartX(task, now?)` — the viewBox x where a task's time-until-due fill
  begins (pinned to `X0`, the "today" edge, once due/overdue); the fill runs
  from there to the drop's right edge, clipped to the drop's outline.
  Time-until-due is quantized to whole days (rounded, matching
  `formatDueShort`) before positioning, so every task "due in 1 day" lands at
  the same axis level regardless of the hours remaining
- `cycleColor(task, now?)` / `outlineColor(task, now?)` — cycle-state color
  (green → yellow across the cycle, red once overdue) for the fill and a
  ~20%-darkened outline shade, so the outline reads as freshness even when
  the fill is empty
- `severeOverdue(task, now?)` — `percentDue(task) >= 200` (overdue by more
  than a full cycle again); thickens the outline stroke

Task and room icons live in `src/lib/icons.tsx` (not `db.ts`): `taskIcon(name)`
returns a keyword-inferred Lucide component, `roomIcon(type)` returns one per
room type (all 8 types, e.g. `BedDouble` for bedroom, `Sun` for balcony,
`Package` for other). Both are monochrome and inherit text color. Also
exports `ICON_REGISTRY` (a `Record<string, LucideIcon>` keyed by the lucide
component's own name — `Task.icon`/the suggestion library reference icons by
these string keys, since a component reference can't be persisted to
IndexedDB), `resolveIcon(name)` (string → component, if known), and
`iconForTask(task)` (the real entry point the main list uses: `task.icon`
resolved via the registry, falling back to `taskIcon(task.name)`).
- `seedDatabase()` — DEV-ONLY: seeds a small starter home/rooms/tasks
  directly, bypassing the setup wizard, for quick local iteration on the main
  list without walking through it every time; no-ops if any room already
  exists. Not wired to any UI button (unlike `randomizeTaskState`) — call it
  from the console if needed. Real first-launch setup goes through the wizard
  (see below)

### Suggestion library (`src/lib/library.ts`)

The setup wizard's task suggestions, ported from the approved mockup
(`SETUP_WIZARD_MOCKUP.html`, kept in the repo root as the design reference)
and grounded in published cleaning-schedule guidance (Tidywell,
HousewifeHowTos, NBC/science roundups). Deliberately **excludes tasks that
announce themselves when undone** — no trash, no dishes, no visible-mess
tidying — since those don't need a reminder; don't add any back.

- `LIB` — per `RoomType`, a `base` task list plus an `equipment` list (each
  equipment option carries its own icon/label and 1+ tasks unlocked by
  selecting it in the wizard), and flags: `floorMop7` (kitchen/bathroom —
  tightens the floor-mop task to 7 days), `windowsCurtains` (adds a curtain
  task alongside the window task for bedroom/living-room/office),
  `noFloor` (balcony — skips the floor question entirely)
- `FLOOR_TASKS` — per floor type (`hard` / `carpet` / `mixed`), the tasks
  that get added for it (e.g. mixed gets vacuum + mop + "shake out rugs")
- `SIZES` / `WINDOWS` / `FLOORS` — the wizard's per-room question options;
  `SIZES` carries the duration-scaling factor (0.7 / 1 / 1.4), `WINDOWS`
  carries the window-cleaning task's duration by count
- `FREQ_STEPS` / `fmtFreq(days)` — the frequency-stepper ladder
  (`[1,2,3,4,5,7,10,14,21,30,45,60,90,120,180]`) and its human labels
  ("every week", "every 2 months", …) used by the task-by-task screen's
  +/− stepper
- `buildTasks(room, profile)` — generates the concrete suggestion list for a
  configured room: applies `pets` (halves frequency, min 1 day, for tasks
  flagged `pets: true`, e.g. vacuuming), `sizeScale` (scales duration by the
  room's size factor, rounded to 5-min steps, min 5), the floor tasks for the
  chosen floor type (mop tightened to 7d if `floorMop7`), the tasks for each
  selected equipment key, a generic "Clean {custom item}" (30d/15min) per
  free-text `custom:` equipment entry, and — if `windows > 0` — a window task
  (60d, duration by count) plus a curtain task if `windowsCurtains`
- `baselineLastCompletedDate(frequencyDays, status, now?)` — the "Build my
  home" day-one baseline: converts a task's chosen state chip (Fresh/Due
  soon/Overdue → 5%/70%/130% of its cycle elapsed) plus random jitter in
  [−10, +10] points (clamped ≥ 0) into a `lastCompletedDate`, so day one
  looks like real life instead of a blank slate

## Product direction (beyond current build)

Decisions made in planning that aren't built yet, kept here so they aren't
lost between sessions:

- **Design principle:** minimize time spent in the app itself — the point is
  to spend time cleaning, not navigating a phone. Competitor research (Tody,
  HomeRoutine, Spotless, OurHome, etc.) informed this: adopt Tody's glanceable
  color-coded urgency and HomeRoutine's "focused time-boxed session" idea;
  explicitly reject gamification (points, streaks, leaderboards, allowance
  systems) as adding engagement overhead rather than speed.
- **Milestone B — setup wizard: done** (see Status below for the built
  flow). One thing from the original plan intentionally deferred to its own
  follow-up: the ⚙︎ gear button that reopens the wizard's overview screen as
  the permanent post-setup home-management surface (add/remove rooms, edit a
  room's config, re-decide tasks) — **this will be the app's only CRUD
  surface once built; no separate add/edit-task screen is planned**. Until
  then there's no way to add/edit/delete tasks after the wizard finishes.
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
  first by `msUntilDue`, with a subtle room label under each task name for
  context. Truest to the glanceable-urgency design principle: the most overdue
  task in the whole apartment is always at the very top.
- **Rooms** — tasks **grouped by room** under a header with a room-type icon
  (`roomIcon`); rooms are ordered by their most-urgent task and tasks within a
  room are sorted most-urgent first (both by `msUntilDue`). For batch-cleaning
  one room at a time.

Both views render identical **compact task cards** via a shared
`renderTask(task, showRoomLabel)` helper (the room label shows only in Urgency
view; the Rooms view's header already provides that context), and share one
**axis legend row** ("today · 1d · 3d · 1w · 2w") above the list, inset to match
the cards' padding so its ticks line up with the bars below. Each card is a
tight layout: a monochrome Lucide task icon + name on the left, a right-aligned
compact due status (`formatDueShort`: "2d over" / "Today" / "3d") colored by
`urgencyBand`, and an SVG **"drop" bar** below — two decoupled encodings on
one shape, replacing an earlier single-quantity progress bar (see git history
for that iteration and the percent-of-cycle design before it):
- **Drop length** (`hornPath`) is the task's own cycle (`frequencyDays`) on
  the shared log-time axis — a daily task is a short stub, a monthly one runs
  long. This is fixed per task, independent of urgency.
- **Fill length** (`fillStartX`, clipped to the drop) is absolute
  time-until-due on that same axis, right-anchored to the drop's end and
  pinned to the left "today" edge once overdue — so fill length is directly
  comparable across tasks regardless of cadence.
- **Fill/outline color** (`cycleColor`/`outlineColor`) encodes cycle state:
  green → yellow across the cycle, red once overdue, with the darker outline
  always visible (even when the fill is a thin sliver) so freshness reads at
  a glance. `severeOverdue` (>= 200%) thickens the outline further.

Cards have no background tint — color is treated as an enhancement, not the
only signal: fill length, outline shape, list sort order, and the day badge
text are all designed to stay legible in grayscale. In Urgency view a small
muted room label (Lucide room icon + name) sits under the task name.

**Completion interaction** (in `App.tsx`'s `TaskCard` component): tapping a
card gives a small press animation (`active:scale`), then blurs the tile in
place (`blur-[2px] opacity-60`, the task name/bar shimmering through as
context) and floats controls on top of it in an `absolute inset-0
overflow-hidden rounded-xl` overlay (`panel-pop`; the active `<li>` gets
`z-30`) — the overlay can never grow past the tile's own footprint, which
stays at its natural collapsed height throughout. There's no Cancel button —
a `fixed inset-0` backdrop dismisses the panel when you tap anywhere outside
the tile. All three interaction states are compact single rows that fit
inside the tile rather than a taller panel stacked below it:
- **Prompt** — `[▷ Start] [✓ Complete]`, both `flex-1`.
- **Start** — runs a stopwatch: a solid pill (pulsing blue dot + `M:SS`,
  always two-digit seconds, `tabular-nums`, ticking every 300ms so the
  seconds never visibly skip) on the left, a compact **✓ Done** button on the
  right. Done rounds elapsed time to the nearest 5 min (floor 5) and logs it.
- **Complete** — opens an iOS-timer-style scroll-snap **`WheelPicker`**, now
  **horizontal** (axis-swapped from an earlier vertical version — values
  scroll left/right, `WHEEL_ITEM_W` = 56px items, `scrollLeft`-based
  centering/reconcile), in 5-min increments (5–90), defaulting to
  `estimatedDurationMinutes` snapped to the nearest 5; the centered value is
  enlarged/bolded, the unit ("m") lives in the Done button rather than next to
  each value since horizontal space is tight. The wheel itself is a `flex-1`
  solid pill with left/right edge fades (instead of top/bottom), and a
  fixed-width **✓ Xm** Done button sits to its right. Initial centering runs
  in `useLayoutEffect` and is re-asserted in a `requestAnimationFrame` so it
  survives the surrounding `panel-pop` panel's layout settling, then
  reconciles once from the actual scroll position so the highlighted value
  and the Done button's value never disagree. Note: the selection band is a
  `position: absolute` sibling rendered *before* the scroll container in the
  DOM — the scroll container needs its own `position: relative` (present) so
  normal DOM-order stacking applies and the band paints behind the values
  instead of on top of them (CSS stacks non-positioned in-flow content below
  auto-z-index positioned siblings regardless of source order). Done logs the
  centered value.

Small-text controls (the stopwatch readout, the wheel) sit on their own solid
`bg-white/95 dark:bg-neutral-900/95` pill (`shadow-sm ring-1 ring-black/5
dark:ring-white/10`) for readability over the blurred tile underneath; every
button in the flow (Start, Complete, both Done buttons) is a **frosted
capsule** instead — `rounded-[10px]`, translucent card-color background +
`backdrop-blur-md` (`bg-white/60 dark:bg-neutral-900/60`) so the blurred tile
glows through, a hairline border, and a leading Lucide icon (`Play` on Start,
`Check` on every Complete/Done). No solid blue/green fills remain in the
completion flow — the pulsing stopwatch dot is the one color accent left.

Both paths then play a **reset animation** (see `playReset`), fully in place,
before anything moves: **drain (~1.4s ease-out) → blink × 3 → a ~200ms beat →
write → glide** (see below). The drop's time-fill drains left→right via
`requestAnimationFrame` (captures the pre-completion fill start + colors so
it animates from the old state, isolated from the live query's refresh of
the now-fresh task), with the fill and outline colors interpolating from
their captured pre-completion values to fresh-state green (`#5ea02e` /
darkened `#497d24`, matching `cycleColor`/`outlineColor` at 0% due) over the
same drain — so an overdue red drop visibly cools back to green as it
empties. After the drain, the outline blinks green **three times**
(`reset-blink` CSS keyframe, `animation-iteration-count: 3`, on an overlaid
green outline path). Only *after* the third blink plus a short beat does the
actual `logCompletion` write fire (guarded to fire exactly once even if the
card unmounts mid-animation, e.g. a view toggle — the write is never lost) —
so the card stays completely in place through the whole visible animation,
and the live-query re-sort it triggers happens only once the animation has
already finished. The animation state (`anim`) is intentionally held open
(phase `'settled'`) through the beat and past the write instead of clearing
on a timer, so the card can't flash back to its old (e.g. red/overdue) live
state in the gap before the live query catches up; it's cleared once `task`'s
`lastCompletedDate` actually changes (a `SETTLE_FALLBACK_MS` = 2s timeout is
just a safety net in case the write never lands). App-level `activeTaskId`
ensures only one card's panel is open at a time. CSS keyframes (`reset-blink`,
`panel-pop`) and the wheel's scrollbar-hiding live in `src/index.css`.

**List reorder (FLIP glide):** whenever a completion (or 🎲 Randomize) causes
`sortedTasks`/`roomGroups` to re-sort, affected task `<li>`s glide to their
new position (~550ms, `cubic-bezier(0.25, 0.8, 0.25, 1)`) instead of jumping —
a dependency-free FLIP implementation (`useFlip` in `App.tsx`): a
`useLayoutEffect` with no dependency array runs after every render, diffs
each tracked `<li>`'s `offsetTop` (not `getBoundingClientRect`, which scroll
position would throw off) against its previous value, and for any that moved,
sets an instant inverted `transform`, forces a reflow, then clears it with a
transition so the browser eases it back to its natural position. Applies in
both views (Urgency flat list and Rooms grouped lists) via a `flipRef(task.id)`
ref factory passed down to each `TaskCard`'s `<li>`. Suppressed across a
`viewMode` toggle (Urgency ↔ Rooms) by clearing the previous-position map on
change, since that's a different list shape, not a reorder. Room *section*
reordering in Rooms view (when a room's most-urgent task changes) is not
glide-animated — only each task's own `<li>` is tracked, so a section header
jumping is a known, accepted gap for now.

Dev helpers in `db.ts`: `randomizeTaskState()` scatters completion dates for
testing, surfaced as a DEV-only 🎲 Randomize button in the header (hidden in
production via `import.meta.env.DEV`); its reshuffle also glides via the same
FLIP mechanism.

No add/edit-task screen or navigation yet beyond the first-launch wizard (see
below) — the app is otherwise read-only past marking a task done. Next up
(still open): the ⚙︎ gear/overview management screen (the planned CRUD
surface — see Product direction), then the "give me X minutes" suggestion
feature (Milestone C).

### Setup wizard (`src/Wizard.tsx`)

First-launch flow, built from the approved `SETUP_WIZARD_MOCKUP.html` mockup
(kept in the repo root as the canonical design reference — every screen,
transition, and the suggestion library data are defined there first).
`App.tsx` renders `<Wizard/>` instead of the main list whenever
`db.rooms` is empty (the automatic `seedDatabase()` call on mount was
removed — `seedDatabase`/`randomizeTaskState` remain as DEV-only helpers, the
🎲 button unchanged); the wizard writes directly to Dexie, so `App`'s
`useLiveQuery` on `db.rooms` picks up the new rooms and swaps back to the
list on its own once "Build my home" completes — no callback needed.

Screens, in order:
1. **Home profile** — Pets / Plants / Work-from-home toggle rows (same
   row styling as room selection); silently seeds the one `Home` row.
2. **Room selection** — the 5 default room types (kitchen, bathroom,
   hallway, bedroom, living room) as toggles, ON by default; a horizontal
   scroll-snap wheel (same centering/reconcile pattern as the main app's
   duration `WheelPicker`, adapted for text labels — see `RoomTypeWheel`) to
   add any of all 8 types; added rooms get an **✕** remove button instead of
   a toggle; duplicate room types auto-number ("Bedroom 2").
3. **Per-room config accordion** — size → windows → floor (skipped for
   `noFloor` types) → equipment grid, one question at a time; each answered
   question collapses into a compact "label · value · edit" row above,
   tap to reopen (`answerStep` jumps to the first still-unanswered step, or
   to the end if none — so reopening an earlier answer doesn't force
   re-walking the rest). Equipment is a 2-column icon grid (multi-select,
   monochrome), plus a dashed **Add** tile → inline text input for
   free-text custom items (stored as `custom:Name`); CTA reads "Empty —
   continue" when nothing is selected. Confirming equipment calls
   `buildTasks()` and moves to that room's task screen.
4. **Task-by-task** — one `buildTasks()` suggestion per card: name,
   estimated duration, a frequency +/− stepper on the `FREQ_STEPS` ladder
   (shows "suggested X" once the user deviates), a Fresh/Due soon/Overdue
   state-chip row (`Sparkles`/`Moon`/`CircleAlert`, tinted with the exact
   green/amber/red from `db.ts`'s `cycleColor` palette — no emoji), and
   Skip/Add task. Decided (added) tasks stack as compact rows above; skipped
   ones leave no trace. After the last suggestion, the same screen switches
   to a **free-text own-task** form (name + frequency stepper, "Add this
   task", repeatable) then "Done with {room} →".
5. **Overview** — every room, expandable to show its added tasks, a
   "settings · edit" line that re-enters that room's config accordion (at
   its first step — a known, mockup-inherited quirk: re-answering that first
   question is what unlocks the rest as reopenable compact rows again),
   "+ Add or remove rooms" (back to room selection), and **Build my home**.
   Deliberate deviation from the mockup here: the mockup's "+ Add or remove
   rooms" round-trip **rebuilds the room list from scratch**, silently
   discarding every room's already-entered config/tasks — that's almost
   certainly an oversight in throwaway prototype JS, not a design decision,
   so `continueToRoomConfig` instead **merges by room name**, preserving any
   room whose name survives the round-trip and only adding/dropping what
   actually changed.
6. **Build my home** — one Dexie transaction: creates the `Home` row, then
   each room and its added tasks, each task's `lastCompletedDate` set via
   `baselineLastCompletedDate` from its chosen state chip. One transaction
   means a crash mid-write can't leave a half-built home (which would also
   wrongly suppress the wizard on next launch).

Navigation: a header back arrow (hidden only on the first Profile screen)
steps backwards through the full hierarchy — task → previous task →
equipment → floor → windows → size → previous room's last task → … → room
selection → profile (`goBack`, mirroring the mockup's structured back-nav).
No entry/slide/scale animations on any wizard screen — the design explicitly
drops them (static renders only, unlike the main list's `panel-pop`/FLIP).

Known limitation (by design, not yet addressed): wizard state lives entirely
in memory — killing the app mid-wizard restarts it from the top. Acceptable
for a one-time first-launch flow; worth revisiting if it becomes annoying in
practice.

## Commands

- `npm run dev` — start dev server
- `npm run build` — type-check and build for production
- `npm run preview` — preview the production build
- `npm run lint` — run oxlint
