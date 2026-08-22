# Claude Code prompt — three completion-flow polish fixes

Three small fixes in the task-completion flow. All UI code is in `src/App.tsx`
(components `TaskCard` and `WheelPicker`), animation CSS in `src/index.css`.
Do NOT change the data layer (`src/lib/db.ts`), the drop-bar geometry/colors,
the Urgency/Rooms views, or what gets stored on completion (rounding rules stay
exactly as they are).

## Fix 1 — stopwatch shows seconds

The Start-path stopwatch currently renders only whole minutes
(`Math.floor(elapsedMs / 60000)`), so for the first minute it sits at "0" and
it's hard to tell it's running at all.

- Change the display to `M:SS` (e.g. `0:07`, `12:04`), seconds always
  two-digit zero-padded. Keep `tabular-nums` so digits don't jitter.
- Update the tick interval so the seconds display is smooth and never visibly
  skips (250–500 ms interval; elapsed time must stay derived from
  `Date.now() - swStartRef.current`, not accumulated per tick).
- Keep the pulsing dot. Drop or adapt the standalone "min" unit label so the
  layout still reads cleanly with `M:SS`.
- Storage behavior unchanged: `finishStopwatch` still rounds to the nearest
  5 minutes with a 5-minute floor.

## Fix 2 — duration wheel: selected value must actually highlight

Bug report: when the Complete path opens the wheel, every value renders grey —
no value appears selected/highlighted, even though the highlight styling
(enlarged, bold, dark `text-neutral-900`) exists in the code.

Likely root cause to verify first: `WheelPicker`'s mount effect sets
`ref.current.scrollTop = idx * WHEEL_ITEM_H` in a plain `useEffect`, while the
surrounding panel is still animating in (`panel-pop`) / before layout has
settled — so the assignment clamps to 0. Result: the visually centered row is
the first value (5 min) while `value` (the task's estimate, e.g. 15) is
off-screen, so no *visible* row matches `value` and everything on screen reads
grey. The `Done (X min)` button then also disagrees with what looks centered.

Fix requirements:

- Initial centering must be reliable: perform it in `useLayoutEffect`, and
  re-assert it in a `requestAnimationFrame` (or equivalent) so it survives the
  panel-pop layout settling. Scroll-snap will hold the row afterward.
- The visually centered row and `value` must never disagree: after initial
  centering, reconcile once from the actual scroll position (i.e. run the same
  logic as `handleScroll`), so whatever row is truly centered is both
  highlighted and what `Done` logs.
- The centered row must render clearly selected: existing enlarged/bold/dark
  styling is fine — make it actually apply. Verify in light and dark mode.

## Fix 3 — completion reset animation: slow drain → green, triple blink

Current behavior (see `playReset` in `TaskCard`, `reset-blink` in
`src/index.css`): a 480 ms drain then a single 0.6 s blink. Bug report: the
user doesn't perceive it working at all. Two things to address — make the
animation match the new spec, and make sure it actually plays to completion.

New spec:

1. **Slow drain.** The time-fill drains left→right (current direction) over
   ~1400 ms with an ease-out. While draining, the fill AND outline colors
   interpolate from their captured pre-completion colors to the fresh-state
   green (`cycleColor` at 0% due = `#5ea02e`, outline = its darkened variant
   from `outlineColor`'s formula). So an overdue red drop visibly "cools" back
   to green as it empties. Reuse the existing rAF loop; interpolate the RGB
   channels alongside `drainX` with the same easing.
2. **Triple blink.** After the drain, the overlaid green outline path blinks
   **3 times** (`RESET_GREEN`). Implement via the existing `reset-blink`
   keyframe with `animation-iteration-count: 3` (≈ 350–400 ms per iteration),
   then clear `anim` after the full 3 cycles so the card returns to its live
   fresh state.
3. **It must actually play.** Investigate why the current animation isn't
   perceived: the immediate `logCompletion` triggers the live query, the task
   becomes fresh, and the list **re-sorts** — the card jumps toward the bottom
   mid-animation, which can make the whole sequence invisible. Preferred fix:
   defer the `logCompletion` call until the drain has finished (fire it when
   the blink phase starts), so the card stays in place for the drain and any
   re-sort jump happens behind the blink. The captured-color approach in
   `playReset` already isolates the animation from the DB refresh — keep that.
   If a card unmounts mid-animation (e.g. view toggle), the completion must
   still be logged — don't lose the write; guard so `logCompletion` fires
   exactly once per completion even if the animation is interrupted.

Verify by completing a task in dev (use the 🎲 Randomize button to get overdue
tasks): you should clearly see the bar drain over ~1.4 s while turning green,
then the outline blink green 3 times, and only then (or invisibly behind the
blinks) the card move to its new sort position.

## Wrap-up

- `npm run build` and `npm run lint` must both pass.
- Update `CLAUDE.md`'s **Status** section to reflect: stopwatch shows `M:SS`,
  wheel highlight/centering fix, and the new reset animation (slow drain with
  color transition to green + triple blink, completion logged after drain).
