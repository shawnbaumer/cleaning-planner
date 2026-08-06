# Claude Code prompt — Focus mode ("give me X minutes", Milestone C)

Build Focus mode: tell the app how much time you have, it filters the list to
the tasks worth doing right now. The canonical spec is
**`FOCUS_MODE_MOCKUP.html` in the repo root** — an approved, fully interactive
mockup. Open and read it first: the header states, the wheel row, the plan
banner, the footers, and the greedy fill are all defined there. This prompt
tells you what to build and where; the mockup tells you exactly how it looks
and behaves. Match it closely (Tailwind idioms instead of its inline CSS are
fine; structure, spacing feel, and copy should match). The mockup's
tap-to-complete is a mockup shortcut ONLY — the real app keeps the full
Start/Complete flow on every card.

**Prerequisite:** the ⚙︎ gear/management screen work must already be merged
(this feature and that one both touch `App.tsx`). Build on top of it; don't
touch the Manage screen.

Scope: everything lives in `src/App.tsx` (plus small helpers where they fit
naturally). No schema changes, no new dependencies. Rooms view, task cards,
completion flow, drop bars, FLIP, wizard, gear screen: all untouched except
where stated.

## 1 — Entry point: timer button on the view-toggle row

A square timer button (lucide `Timer`, monochrome, `--band`-style background
matching the segmented toggle) to the RIGHT of the Urgency/Rooms toggle, same
height, per the mockup. Tapping it swaps that row into **pick mode**.

## 2 — Pick mode (choose the minutes)

The toggle row is replaced (same vertical space — the header must not jump) by:
- a small text **Cancel** button (back to normal),
- the horizontal minute wheel — **reuse the existing `WheelPicker`** and its
  `WHEEL_VALUES` (5–90 in 5s) from the completion flow; visually it sits in a
  card-colored pill with the center band + edge fades, per the mockup,
- a solid **Go button** (lucide `Play` icon + live "`{n}`m" label, inverted
  black/white style) that starts Focus.

Default 30 minutes; remember the last-used value in component state for the
session (not persisted).

## 3 — The plan (greedy fill) — this is the feature

Computed ONCE when Go is tapped:

- **Eligible**: tasks with `percentDue(task) >= 75` (the 'soon' + 'overdue'
  bands — freshly-done tasks are never suggested; matches the mockup's
  `FOCUS_ELIGIBLE_PD`).
- Sort eligible by `msUntilDue` ascending (most urgent first).
- Walk the list, picking every task whose `estimatedDurationMinutes` fits the
  **remaining** budget (skip one that doesn't fit, keep walking — smaller
  tasks behind it may still fit). Track how many eligible tasks didn't fit.
- The plan is **static**: store the picked task ids + the Go timestamp
  (`planStart`) + budget + skipped count. It does NOT recompute as time
  passes or tasks complete. A planned task counts as done once its
  `lastCompletedDate > planStart` (robust against the live query refreshing
  task objects).

## 4 — Focus state (the filtered list)

While a plan is active, per the mockup:

- The view-toggle row is replaced by the **plan banner**: inverted
  (black/white) rounded card — Timer icon, "`N` tasks · ~`X` min planned"
  (N and X = the *remaining* planned tasks and the sum of their estimates,
  live-updating as tasks complete), subtitle "fits your `B` minutes" plus
  " · `k` due tasks didn't fit" when k > 0, and an **✕** button that exits
  back to the normal list. Focus mode temporarily supersedes the
  Urgency/Rooms choice; exiting restores whatever `viewMode` was (the
  persisted preference is never touched).
- The list shows ONLY the planned tasks, in plan (urgency) order, rendered
  as the normal `TaskCard`s — full Start/Complete flow, reset animation,
  FLIP glide all work — with the room label shown AND a small muted
  "~`X`m" estimate after it (focus mode only; the estimate is exactly the
  card's `estimatedDurationMinutes`).
- Footers (muted, centered, per the mockup): if k tasks didn't fit —
  "`k` due tasks didn't fit in `B` min — **still on the full list**." If
  everything eligible fit with ≥ 5 min left over — "That's everything due —
  **~`X` min to spare**."
- **All planned tasks completed** → the quiet end state: big outlined
  green check (lucide `CircleCheck`-style), "All done", "`N` tasks in under
  `B` minutes.", and a "Back to the full list" ghost button. No confetti, no
  streaks — the design explicitly rejects gamification.
- **Empty plan** (Go with nothing eligible): enter focus anyway with a quiet
  "Nothing due right now — enjoy your `B` minutes." and the same back
  button. (Not in the mockup; keep it to the same tone.)

Focus/plan state is in-memory only — killing the app exits focus. Completing
a task mid-animation, toggling dark mode, etc. must not lose the plan.

## 5 — Details that must hold

- The banner's remaining count/minutes derive from the live tasks via the
  `lastCompletedDate > planStart` rule — completing a task from the plan
  updates the banner and (after its reset animation) the card leaves the
  list via the existing FLIP/live-query flow.
- The axis legend row stays above the list in focus mode, aligned as always.
- DEV 🎲 Randomize still works; if it makes a planned task suddenly fresh,
  that's fine — the plan is static by design (ids don't change).
- No entry/slide animations for pick mode or the banner (same static-render
  rule as the wizard); the existing card/FLIP animations are untouched.

## Wrap-up

- `npm run build` and `npm run lint` must pass.
- Manual test: pick 40 min on a randomized list and verify the greedy skip
  (a big task skipped, smaller later ones included; skipped count right);
  complete a planned task via Start AND via Complete (banner updates after
  the animation, card glides out); finish the whole plan → All done state →
  back restores the previous view; ✕ mid-plan restores the previous view;
  Go with everything fresh → empty-plan state; toggle dark mode throughout.
- Update `CLAUDE.md`: Milestone C is DONE — document the timer button, pick
  mode (WheelPicker reuse), the greedy plan rules (eligibility threshold,
  static plan, `planStart` completion rule), banner/footer/end states, and
  that focus state is deliberately in-memory only. Remaining roadmap after
  this: deployment to the iPhone, then Milestone D ideas.
