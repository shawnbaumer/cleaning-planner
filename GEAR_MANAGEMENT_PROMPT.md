# Claude Code prompt — ⚙︎ gear / home-management screen (prompt B)

Build the post-setup home-management screen behind a ⚙︎ gear button in the
main app header. The canonical spec is **`GEAR_MANAGEMENT_MOCKUP.html` in the
repo root** — an approved, fully interactive mockup. Open and read it first:
every screen, label, confirm dialog, and the config-diff / re-decide logic
are defined there. This prompt tells you what to build and where; the mockup
tells you exactly how it looks and behaves. Match it closely (Tailwind idioms
instead of its inline CSS are fine; structure, spacing feel, and copy should
match). The mockup's first screen is a stand-in for the real main list — only
the gear button on it is new.

This is the app's **only CRUD surface** — no separate editor screens exist or
are planned. Everything on it **saves immediately** (iOS-Settings style, no
Save button); the only confirms are for destructive actions.

Scope: gear button + Manage screen (household profile, per-room task
editing, add-task, config re-edit with smart re-decide, add/remove rooms).
**Out of scope (do NOT build now):** "give me X minutes" (Milestone C),
notifications, multi-home UI.

## 1 — Entry point (`src/App.tsx`)

- A ⚙︎ button (lucide `Settings`, monochrome, matching header style) on the
  main list header, right side (before the DEV 🎲 button). Tapping it shows
  the Manage screen; its header back arrow returns to the list. Simple
  App-level state (`'list' | 'manage'`) is fine — no router.
- Do not touch the task cards, completion flow, drop bars, or view toggle.

## 2 — Manage screen → `src/Manage.tsx`

Header title "Your home". Content, top to bottom, exactly as the mockup:

1. **Household card** — collapsed: `House` icon + "Household" + summary of
   active toggles ("Pets, Plants"). Expanded: the wizard's three toggle rows
   (Pets / Plants / Work from home) writing straight to the single `homes`
   row on tap, plus the note that changes only affect *future* suggestions.
   Changing these must NOT touch any existing task (no recomputation).
2. **Room cards** — per room: room icon, name, "N tasks ▾" (tap header to
   expand), and the settings line "Medium · 1 window · Hard floor ·
   edit setup" (tap → config re-edit, §4). Expanded, the card lists the
   room's tasks as compact rows (name + "every week · ~15m" + "edit") and a
   dashed "+ Add task" row (§3).
3. **Task row → inline editor** (tap a row; one open at a time, reopening
   another closes it): name text input (rename on change/blur, trimmed,
   ignore empty), frequency +/− stepper on `FREQ_STEPS` showing "suggested X"
   when it deviates from the library's suggested frequency, a read-only
   duration note ("Takes about ~15 min — adapts automatically as you log
   completions"), **Delete task** (red text button → inline red confirm card
   "…Its completion history goes with it." Cancel / Delete) and **Done**
   (collapses the editor).
   - "Suggested" frequency is **derived, not stored**: match the task's name
     against `buildTasks()` output for the room's current config + profile;
     if found, that's the suggestion. Renamed/own tasks simply show no
     suggested line. No schema change.
   - Deleting a task deletes its `CompletionLog` rows too, in one Dexie
     transaction.
4. **"+ Add or remove rooms"** ghost CTA at the bottom (§5).

## 3 — Add task (inside an expanded room card)

"+ Add task" swaps to an inline panel, exactly as the mockup:

- **"Suggestions you skipped"** — `buildTasks(room config, profile)` minus
  tasks already in the room (match by name). Each row: name + freq + duration
  + "+"; tapping one opens a draft card: freq stepper (with "suggested"),
  **Fresh / Due soon / Overdue** state chips (same icons/colors as the
  wizard), Back / **Add task**.
- Below a divider, **"or your own"**: free-text name + freq stepper → Next →
  the same draft card (default 10 min, status Due soon preselected).
- **Add task** writes immediately: `lastCompletedDate` from
  `baselineLastCompletedDate(freq, status)` (the wizard's Fresh 5% / Due soon
  70% / Overdue 130% ± jitter math — reuse it, don't reimplement). Library
  tasks carry their library `icon`; own tasks get none (keyword inference
  fallback, same as the wizard).

## 4 — Edit setup (config re-edit with smart re-decide)

Tap a room's settings line → the config accordion from the wizard, in
**edit mode**: ALL steps shown as compact answered rows, no question open
initially; tapping a row opens just that question; answering collapses it
again (no forced re-walk — this deliberately fixes the wizard-overview
quirk). Equipment grid's CTA reads "Done" and just collapses. Sub-copy per
the mockup ("Tap a line to change it…"). Bottom CTA **Done** applies:

- Snapshot the config on entry (`cfg0`). On Done compute
  `lib0 = buildTasks(cfg0, profile)` and `lib1 = buildTasks(new config,
  profile)` — **both with the current profile**, so a profile change alone
  never produces a diff here.
- **New suggestions** = in `lib1`, not in `lib0`, and not already a task
  (by name) → the **re-decide screen** (§6), one by one.
- **Orphaned tasks** = existing non-own tasks whose name is in `lib0` but
  not `lib1` (their equipment/floor/window source was removed) → after the
  new suggestions, one keep-or-remove prompt listing them ("No longer part
  of {room}'s setup" · Keep them / Remove all N). Removing cascades their
  completion logs (transaction). Keeping them is a first-class choice.
- Everything else — existing tasks, their frequencies, history, duration
  estimates — is untouched. Config field changes themselves (size, windows,
  floor, equipment) save when Done is tapped (one write is fine).
- No diff → Done goes straight back to Manage.

## 5 — Add / remove rooms screen

Exactly as the mockup ("Rooms" title, sub-copy warning about deletion):

- Current rooms as rows: icon, name, task count, ✕ → inline red confirm
  ("Remove {room}? Its N tasks and their completion history will be
  deleted.") → cascade-delete room + tasks + logs in one transaction.
- Removing the LAST room is allowed — the app's existing `rooms.length === 0`
  check then re-launches the setup wizard. That's intended ("start over");
  just make sure nothing crashes on the way out.
- "Add another room": the wizard's room-type snap-wheel + "+" button,
  duplicate names auto-numbered against existing rooms. Adding starts the
  **new-room flow**: config accordion in wizard mode (steps advance as
  answered) → re-decide screen (§6) over ALL of the new room's suggestions.
  - **Deviation from the mockup (build it this way):** the mockup pushes the
    room into state immediately and removes it if you back out; the real app
    should keep the new room as in-memory draft and write room + added tasks
    in ONE Dexie transaction only when re-decide finishes — no half-built
    room can ever appear in the main list. Backing all the way out discards
    the draft.
- **Done** CTA → back to Manage.

## 6 — Re-decide screen (shared by §4 and §5)

The wizard's task-by-task card, reused: decided tasks stack compactly above;
current card has name, "~X min · i of n suggestions", freq stepper (with
"suggested …" on deviation), Fresh/Due soon/Overdue chips, Skip / Add task.
In edit mode it's prefaced with "Your setup change unlocked these — decide
each one. Nothing else changes." No own-task step here (Manage's add-task
covers that). Added tasks get `baselineLastCompletedDate` from their chosen
chip. Header back = skip the rest and finish (decided ones still land).
Afterwards return to Manage with the affected room expanded.

## 7 — Component reuse

The config accordion, task-decide card, toggle row, freq stepper, and state
chips already exist inside `src/Wizard.tsx`. **Extract and share them**
(export from Wizard.tsx or move to e.g. `src/components/wizard-shared.tsx` —
your call) rather than duplicating; zero visual divergence between wizard
and manage. Keep the wizard's behavior byte-identical after the refactor.
No new dependencies. No entry/slide animations anywhere on manage screens
(same rule as the wizard).

## Wrap-up

- `npm run build` and `npm run lint` must pass.
- Manual test: gear in/out; toggle Pets and verify no task changed; rename +
  refreq + delete a task (check its logs are gone via console/Dexie); add a
  skipped suggestion and an own task, verify their bars land per chosen
  state; edit a room's setup removing equipment (keep, then re-edit and
  remove) and adding equipment (re-decide fires only for the new tasks);
  add a whole room and back out mid-way (no partial writes), then add it for
  real; remove a room and confirm its tasks vanish from both views; remove
  ALL rooms and confirm the wizard relaunches cleanly.
- Update `CLAUDE.md`: gear button + Manage screen (the app's only CRUD
  surface, save-immediately semantics), the config-diff re-decide rules,
  derived suggested-frequency, cascade-delete behavior, the new-room
  draft-transaction, and the shared-component refactor. Mark the
  "no task/room CRUD" gap as closed; next open milestone is C ("give me X
  minutes") and iPhone deployment.
