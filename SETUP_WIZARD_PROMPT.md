# Claude Code prompt — home setup wizard (schema + library + wizard flow)

Build the home setup wizard. The canonical spec is **`SETUP_WIZARD_MOCKUP.html`
in the repo root** — an approved, fully interactive mockup. Open and read it
first: every screen, transition, label, icon choice, the suggestion library
data, and the back-navigation logic are defined there. This prompt tells you
what to build and where; the mockup tells you exactly how it looks and behaves.
Match it closely (Tailwind idioms instead of its inline CSS are fine; the
structure, spacing feel, and copy should match).

Scope: schema upgrade, suggestion library module, the wizard itself, and
first-launch integration. **Out of scope (next prompt, do NOT build now):**
the ⚙︎ gear button / post-setup home-management screen. The wizard's own
overview screen IS in scope.

## 1 — Schema (Dexie version bump + upgrade migration) in `src/lib/db.ts`

- New table `homes`: `++id, name`. Fields: `name` (default `"Home"`),
  `pets: boolean`, `plants: boolean`, `wfh: boolean`. The wizard creates
  exactly one, silently — there is NO home-related UI anywhere. (Schema-ready
  for a future multi-home/sharing milestone; UI-dormant by design.)
- `rooms` gains: `homeId`, `sizeClass: 'S'|'M'|'L'`, `windows: 0|1|2|3`
  (3 = "3 or more"), `floor: 'hard'|'carpet'|'mixed'|null` (null for
  balcony/no-floor types), `equipment: string[]` (library keys AND free-text
  custom items, distinguishable by prefix e.g. `custom:Espresso machine`).
- `RoomType` union gains `'hallway' | 'office' | 'balcony'`.
- `tasks` gains optional `icon?: string` (lucide icon name). `taskIcon(name)`
  keyword inference stays the fallback when `icon` is unset.
- Upgrade migration: existing rooms/tasks (dev databases) get attached to a
  newly created default home; new room fields get sensible defaults
  (`sizeClass 'M'`, `windows 1`, `floor 'hard'`, `equipment []`).

## 2 — Suggestion library → `src/lib/library.ts`

Port **verbatim** from the mockup's `LIB`, `FLOOR_TASKS`, `SIZES`, `WINDOWS`
constants (typed properly). These frequencies are research-grounded
(Tidywell / HousewifeHowTos / NBC science roundups — keep the mockup's source
comment) and the task set deliberately EXCLUDES self-announcing chores (trash,
dishes, visible-mess tidying) — do not add any back.

Also port the modifier rules exactly as the mockup's `buildTasks()` applies
them:
- `pets: true` on a task + home has pets → frequency halves (min 1 day).
- `sizeScale: true` → duration × 0.7 / 1.0 / 1.4 by sizeClass, rounded to
  5-min steps, min 5.
- Windows > 0 → add "Clean windows inside" (60d; duration 10/15/25 by count),
  plus "Wash curtains / dust blinds" (120d) only for types with
  `windowsCurtains` (bedroom, living-room, office).
- `floorMop7` (kitchen, bathroom) → the mop task tightens to 7d.
- Custom equipment `X` → task "Clean x" 30d / 15min.
- Frequency ladder `FREQ_STEPS = [1,2,3,4,5,7,10,14,21,30,45,60,90,120,180]`
  and the `fmtFreq` labels ("every week", "every 2 months", …).

Each library task should carry a lucide icon name for the new `tasks.icon`
field (pick sensible ones; e.g. sheets → `BedDouble`, oven → `Flame`,
windows → `PanelsTopLeft`/`Blinds`, watering → `Droplets`).

## 3 — Wizard UI → `src/Wizard.tsx` (one file is fine)

Screens, in order, exactly as the mockup (`rSelect → rConfig → rTasks →
rOwnTask → next room → rOverview → done`):

1. **Room selection** — 5 default rooms (kitchen, bathroom, hallway, bedroom,
   living room) as toggle rows, ON by default; added rooms get an ✕ remove
   button instead of a toggle; "Add another room" horizontal snap-wheel of
   all 8 types + a `+` button; duplicates auto-number ("Bedroom 2"). CTA
   shows the live count.
   Precede this with the home-profile question set from the earlier design:
   the mockup hardcodes `pets/plants/wfh` in state — build a real first
   screen for them (three toggle rows: Pets / Plants / Work from home,
   matching the room-row styling), then room selection.
2. **Per-room config accordion** — size (with m² ranges) → windows
   (none/1/2/3+) → floor (skipped for balcony) → equipment grid. Each
   answered question collapses into a compact row pinned above (label +
   value + "edit"), tap to reopen. Equipment grid: monochrome lucide icons,
   2 columns, multi-select, dashed **Add** tile → inline input for custom
   items, CTA reads "Empty — continue" when nothing is selected.
3. **Task-by-task** — one suggestion at a time in a focused card: name, ~min,
   "x of n suggestions", frequency stepper on the ladder (shows "suggested
   …" beneath when user deviates), state chips **Fresh / Due soon / Overdue**
   with the mockup's monochrome icons (sparkles / half-circle / alert-circle
   tinted green/amber/red — NOT emojis/smileys), Skip / Add task buttons.
   Added tasks stack as compact rows above (state icon + name + freq + ✓).
4. **Own task** — after the last suggestion: free-text name + frequency
   stepper, "Add this task" (repeatable), then "Done with {room} →".
5. **Overview** — all rooms with icon, task count (expandable list), settings
   line (tap → re-enter that room's config accordion, all steps answered/
   compact), "+ Add or remove rooms" (back to selection, existing choices
   preserved), CTA **"Build my home"**.
6. **Done** — writes everything, lands on the main task list (the mockup's
   preview-bars screen is just its stand-in for the real list — landing
   directly on the real main list is correct; a brief "Home built" moment is
   optional).

Navigation details:
- **Header back arrow on every wizard screen**, stepping backwards through
  the exact hierarchy in the mockup's `goBack()`: task → previous task →
  equipment → floor → windows → size → previous room's tasks → … → room
  selection. Port that logic.
- No entry/slide/scale animations on selections — the design explicitly
  dropped them. Static renders only.
- Room-type icons: use the closest lucide-react equivalents of the mockup's
  hand-drawn set (CookingPot, Bath, DoorOpen, BedDouble, Sofa, Monitor, Sun,
  Package; equipment: Refrigerator, Microwave, WashingMachine, Flame,
  Sprout, …). Monochrome, `currentColor`, consistent stroke.

## 4 — Baseline math (Good / So-so / Ugly → lastCompletedDate)

On "Build my home", for each added task compute percent-of-cycle elapsed:
Fresh = 5%, Due soon = 70%, Overdue = 130%, each + random jitter in
[−10, +10] percentage points (clamp ≥ 0). Then
`lastCompletedDate = Date.now() − (pd/100) × frequencyDays × MS_PER_DAY`.
This is what makes day one look like real life instead of a blank slate.

## 5 — Integration

- Remove the automatic `seedDatabase()` call from `App`. New logic: rooms
  table empty → render `<Wizard/>`; otherwise the normal list. Keep
  `seedDatabase` and `randomizeTaskState` as DEV-only helpers (🎲 button
  unchanged).
- "Build my home" writes home + rooms + tasks in ONE Dexie transaction, so a
  crash mid-write can't leave a half-built home (which would also suppress
  the wizard on next launch).
- Wizard state lives in memory; killing the app mid-wizard restarts it.
  Acceptable for now — note it in CLAUDE.md as a known limitation.
- Do not touch the main list, task cards, completion flow, or drop bars.

## Wrap-up

- `npm run build` and `npm run lint` must pass.
- Manual test: full run (6 rooms incl. a custom-equipment item and an own
  task), back-arrow from deep in room 3 all the way out to room selection
  and forward again, overview edit round-trip, then verify the built list's
  bars are scattered per the chosen states and pets actually halved the
  vacuum cycles.
- Update `CLAUDE.md`: schema v-bump (homes / room fields / task icon),
  library module + its research basis and self-announcing-tasks rule, wizard
  flow summary, first-launch behavior, and the planned-but-not-built gear
  screen. If the in-tile panels change is still undocumented there, bring
  that current too.
