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
│   ├── components/
│   │   └── wizard-shared.tsx  Config accordion, task-decide card, toggle row,
│   │                          freq stepper, state chips — shared by the wizard
│   │                          and the gear/manage screen
│   ├── App.tsx           Root component (renders Wizard on first launch, or
│   │                     Manage behind the gear button)
│   ├── Wizard.tsx         First-launch home setup wizard
│   ├── Manage.tsx         Post-setup home-management screen (the gear button)
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
- `deleteTaskCascade(taskId)` / `deleteTasksCascade(taskIds)` —
  deletes a task (or a batch of tasks) along with its `CompletionLog` rows,
  in one transaction. Used by Manage's task-row delete and the config
  re-edit's "remove all N orphaned tasks" flow
- `deleteRoomCascade(roomId)` — deletes a room along with all of its tasks
  and their completion logs, in one transaction. Used by Manage's
  add/remove-rooms screen

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
- `suggestedFrequencyForTask(taskName, room, profile)` — Manage's "suggested"
  frequency line is **derived, not stored**: matches an existing task's name
  against `buildTasks(room, profile)` for the room's *current* config and
  returns that match's frequency, or `null` if nothing matches (a renamed
  task, or a free-text "own" task). No schema field for this — if the room's
  setup changes after a task was added, the suggested line reflects the new
  setup, not whatever the task was created with

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
  flow).
- **Gear / home-management screen: done** (see Home management below) —
  the app's only CRUD surface (add/remove rooms, edit a room's config,
  rename/re-frequency/delete tasks, add tasks); there is still no separate
  add/edit-task screen, by design.
- **Milestone C — Focus mode ("give me X minutes"): done** (see Focus mode
  below) — a timer button next to the view toggle; pick a budget, get a
  static, greedily-packed subset of due/overdue tasks. No new data-model
  fields — reads directly off `percentDue`/`estimatedDurationMinutes`,
  both already implemented.
- **Next up:** deployment to the iPhone (PWA install/offline is already
  built — this is about actually getting it on-device and living with it),
  then Milestone D (later/optional): push notifications/reminders,
  per-plant or per-furniture task customization, multi-device sync, sharing
  with roommates.

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

Task/room CRUD lives entirely behind the ⚙︎ gear button (see Home management
below) — there's still no separate add/edit-task screen, by design. Focus
mode (see below) lives behind a timer button next to the view toggle. Next
up: deployment to the iPhone.

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

The config accordion, task-decide card, toggle row, freq stepper, and state
chips are extracted into `src/components/wizard-shared.tsx` and shared with
the gear/manage screen (see Home management below) — refactored out of this
file with no behavior change (byte-identical wizard flow before and after).

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

### Home management (`src/Manage.tsx`)

The app's **only CRUD surface** — no separate add/edit-task screen exists or
is planned. Reached via a monochrome ⚙︎ (`Settings`) button in the main
list's header, right of the view toggle and left of the DEV 🎲 button
(`App.tsx`'s `screen` state, `'list' | 'manage'`); the Manage screen's own
header back arrow returns to the list. Built from the approved
`GEAR_MANAGEMENT_MOCKUP.html` mockup (kept in the repo root alongside the
wizard's mockup as the design reference).

**Everything on this screen saves immediately** (iOS-Settings style — no
Save button anywhere); the only confirms are for destructive actions (delete
task, remove room). Screens, reached from the top-level "Your home" list:

1. **Household card** — collapsed shows a summary of active toggles
   ("Pets, Plants"); expanded, the wizard's three toggle rows write straight
   to the `homes` row on tap. Changing these **never touches an existing
   task** — no recomputation, only future suggestions are affected (verified
   manually: toggling Pets with existing tasks open leaves every task's
   frequency untouched).
2. **Room cards** — per room: icon, name, "N tasks ▾" (tap to expand), and
   a "{size} · {windows} · {floor} · edit setup" line (tap → config re-edit,
   below). Expanded, each task is a compact row (name + "every week · ~15m"
   + "edit"); tapping it opens an inline editor (one open at a time — the
   same pattern used across this screen for editor/add-panel/confirm state):
   a name input (rename on blur, trimmed, empty ignored), a frequency
   stepper, a read-only duration note, **Delete task** (red text → inline
   red confirm card, cascades via `deleteTaskCascade`), and **Done**. The
   stepper's "suggested" line is derived via `suggestedFrequencyForTask`
   (see Suggestion library above) — never stored, so renamed/own tasks
   simply show no suggested line.
3. **"+ Add task"** (dashed row, inside an expanded room card) → an inline
   panel: **"Suggestions you skipped"** (`buildTasks(room, profile)` minus
   tasks already in the room, matched by name) as tappable rows, each
   opening a draft card (freq stepper, Fresh/Due soon/Overdue chips,
   Back/Add task); below a divider, **"or your own"** (free-text name + freq
   stepper → Next → the same draft card, defaulting to 10 min/Due soon).
   Committing writes the task immediately with `lastCompletedDate` from
   `baselineLastCompletedDate`. Library-picked tasks carry the library's
   icon; own tasks get **no** `icon` field at all (falls back to
   `taskIcon`'s keyword inference, same fallback path as everything else —
   a deliberate simplification vs. the mockup, which stores an initial-value
   comparison for own tasks too; this app never stores anything to derive a
   "suggested" line from, own or otherwise).
4. **Config re-edit ("edit setup")** — the wizard's config accordion
   (`RoomConfigAccordion` from `wizard-shared.tsx`) in **edit mode**: all
   steps start compact/answered, nothing open initially; tapping a row opens
   just that question, answering collapses it back to nothing open — a
   deliberate fix of the wizard's own "reopening an early answer temporarily
   hides the later ones" quirk (see Setup wizard above), which only applies
   in the wizard's linear/index-based stepping. The equipment step's own CTA
   reads "Done" and just collapses the step (no diff fires there); a
   separate bottom **Done** button applies the change:
   - Snapshots the config on entry (`cfg0`). On Done, computes
     `lib0 = buildTasks(cfg0, profile)` and `lib1 = buildTasks(newConfig,
     profile)` — **both against the current profile**, so a household
     toggle change alone can never produce a diff here.
   - **New suggestions** — in `lib1`, not in `lib0`, and not already a task
     by name — route to the re-decide screen (below), one at a time.
   - **Orphaned tasks** — existing tasks whose name is in `lib0` but not
     `lib1` (their equipment/floor/window source was removed) — offered
     *after* the new suggestions as a single keep-or-remove prompt ("No
     longer part of {room}'s setup"); removing cascades via
     `deleteTasksCascade` in one transaction. A task is only a removal
     candidate by **name match against the library output** — there's no
     stored "is this an own task" flag (no schema change), so a task is
     never removed just because its *origin* was equipment; only because
     its name matches something the library no longer generates.
   - The room's config fields themselves (size/windows/floor/equipment)
     persist in one `db.rooms.update` when Done is tapped, regardless of
     whether any diff fired. No diff at all → Done returns straight to
     Manage.
5. **"+ Add or remove rooms"** — current rooms as rows (icon, name, task
   count, ✕ → inline red confirm → `deleteRoomCascade`); removing the *last*
   room is allowed and falls straight through to the app's existing
   `rooms.length === 0` check, which relaunches the wizard (verified
   manually — no crash, clean restart). "Add another room" reuses the
   wizard's room-type wheel; duplicate types auto-number against the
   current room list. Adding a room enters the config accordion in
   **wizard mode** (steps advance as answered, same component as the
   wizard's own per-room config — including that same reopening quirk,
   since this path *is* the wizard's own stepping behavior) → re-decide
   over *all* of the new room's suggestions.
   - **Deliberate deviation from the mockup:** the mockup pushes the new
     room into its `state.rooms` immediately and splices it back out if you
     back out mid-config. The real app instead keeps the new room as an
     **in-memory draft** (`Manage`'s local `cfg`/`rd` state) and writes the
     room *and* its decided tasks in **one Dexie transaction only when
     re-decide finishes** — so a half-built room can never appear in the
     main list or the room list, and backing out at any point (including
     via the header back, which steps back one question at a time before
     finally discarding — mirroring the wizard's own back-nav) discards the
     draft with zero writes (verified manually via IndexedDB inspection).
6. **Re-decide screen** — shared with §4, reusing the wizard's task-by-task
   card (`TaskDecideCard` from `wizard-shared.tsx`): decided tasks stack
   compactly above, the current card shows name/duration/index, freq
   stepper, Fresh/Due soon/Overdue chips, Skip/Add task. In config re-edit
   mode it's prefaced with "Your setup change unlocked these — decide each
   one. Nothing else changes."; the add-room path has no such preface since
   nothing existed before. Header back skips the rest of the list and
   finishes immediately — decided tasks still land, undecided ones are
   dropped (implemented as a `useEffect` that fires the commit once the
   suggestion list is exhausted and there's nothing left to prompt for
   removal, rather than the mockup's imperative "render() falls through to
   finish()"). Finishing returns to Manage with the affected room expanded.

The screen resets its local UI state (which room/task is expanded, which
editor is open) every time it mounts — no state persists across a gear
open/close cycle, matching the wizard's own "lives entirely in memory while
open" behavior.

### Focus mode (`src/App.tsx`)

"Give me X minutes" (Milestone C) — everything lives in `App.tsx` (a `Timer`
button, a couple of small helper components, and some local state); no
schema changes, no new dependencies, no changes to the Rooms view, task
cards, completion flow, drop bars, FLIP, wizard, or gear screen beyond what's
described here. Built from the approved `FOCUS_MODE_MOCKUP.html` mockup
(kept in the repo root); the mockup's tap-to-complete is a mockup shortcut
only — every card in the real app keeps the full Start/Complete flow, reset
animation, and FLIP glide.

A square `Timer` button sits to the right of the Urgency/Rooms toggle
(`App`'s `focusScreen` state, `'normal' | 'pick' | 'focus'`). Tapping it
swaps that same header row — same height, so the header never jumps —
through three states:

1. **Pick** — a small **Cancel** button, the minute wheel (the completion
   flow's `WheelPicker` and `WHEEL_VALUES` reused as-is, 5–90 in 5s), and a
   solid **Go** button showing the live "`{n}`m" value. Defaults to 30;
   `pickMinutes` stays in component state across Cancel/reopen so it's
   remembered for the session (never persisted).
2. **Focus** — the plan banner (see below) replaces the row.
3. Back to **normal** — the ✕ on the banner, or finishing/backing out,
   restores the ordinary Urgency/Rooms toggle. `viewMode` itself (and its
   `localStorage` persistence) is never touched by any of this — Focus mode
   temporarily supersedes it, then hands back whatever it was.

**The plan (greedy fill) — computed once, on Go, and never recomputed:**
tasks with `percentDue(task) >= FOCUS_ELIGIBLE_PD` (75 — the 'soon' and
'overdue' urgency bands; freshly-done tasks are never suggested) are sorted
by `msUntilDue` ascending (most urgent first), then walked greedily: a task
whose `estimatedDurationMinutes` still fits the remaining budget is picked
and the budget shrinks by that amount; a task that doesn't fit is skipped
(counted, not dropped) and the walk continues — a smaller task later in the
list can still fit after a bigger one is skipped. The result (`FocusPlan`)
is a fixed `{ ids, budget, skipped, planned, left, planStart }`: `ids` is
the picked set in that fixed urgency order, `planStart` is the Go
timestamp. The plan does not change shape as time passes or tasks complete
— completion is detected live via `isPlannedTaskDone(task, plan)`, which is
just `task.lastCompletedDate > plan.planStart` (robust to the live query
handing back a fresh `Task` object with the same id).

**While a plan is active:**
- The **banner** (`FocusBanner`) is an inverted (black/white, flips with
  dark mode) pill replacing the toggle row: a `Timer` icon, "`N` tasks ·
  ~`X` min planned" (`N`/`X` = the *remaining* planned tasks/estimate sum,
  live), a muted subtitle ("fits your `B` minutes" + " · `k` due tasks
  didn't fit" when `k > 0`), and an ✕ that exits back to normal
  (discarding the plan — Focus/plan state is in-memory only by design,
  never persisted, so this is just `setPlan(null)`).
- The list shows **only** the remaining planned tasks, in the plan's fixed
  order, as ordinary `TaskCard`s (`showRoomLabel` **and** the new
  `showEstimate` prop, which adds a small muted "~`X`m" —
  `estimatedDurationMinutes` — after the room label; focus-only, no other
  call site sets it).
- **Footer**, below the list, static per the plan (not recomputed as tasks
  complete): if `plan.skipped > 0`, "`k` due tasks didn't fit in `B` min —
  **still on the full list**."; else if `plan.left >= 5`, "That's
  everything due — **~`X` min to spare**."; otherwise nothing.
- Once every planned task is done, `FocusEndState` replaces the list — a
  big outlined `CircleCheck`, and either "All done" / "`N` tasks in under
  `B` minutes." (a real plan that got finished) or, if the plan started
  empty (nothing was eligible when Go was tapped), the quieter single-line
  "Nothing due right now — enjoy your `B` minutes." Both cases share the
  same "Back to the full list" ghost button. No confetti, no streaks — same
  anti-gamification stance as the rest of the app.

**FLIP interaction:** `useFlip` (in `App.tsx`) takes a `shapeKey` string
instead of just `viewMode` now — `'focus'` while a plan is active,
`viewMode` otherwise — so entering/exiting Focus mode (a drastic list-shape
change) suppresses glide the same way an Urgency↔Rooms toggle already did,
while completions *within* an active plan still glide normally (the key
stays `'focus'` for the plan's whole lifetime, so a completed task
disappearing from the filtered list still closes the gap with a FLIP glide
on the remaining cards — there's no separate exit animation for the
completing card itself; its own drain→blink→settle reset animation is the
transition, and once the deferred write lands the card simply isn't in the
next render's filtered array).

Switching to the ⚙︎ gear screen and back does not lose an active plan — the
`App` component itself never unmounts for that (it's a sibling `screen`
state that early-returns a different render, not a route change), so
`focusScreen`/`plan` survive untouched, consistent with "in-memory only"
meaning *session*-scoped, not *view*-scoped.

## Commands

- `npm run dev` — start dev server
- `npm run build` — type-check and build for production
- `npm run preview` — preview the production build
- `npm run lint` — run oxlint
