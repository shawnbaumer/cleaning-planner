# Claude Code prompt — confine all completion panels to the tile

Goal: the completion interaction never grows past the tile. Today the
Start/Complete prompt already overlays the tile exactly (`absolute inset-0`),
but the stopwatch and wheel states render a taller solid panel
(`absolute inset-x-0 top-0` + `cardFace` + controls) that hangs over the cards
below. Replace both with compact in-tile layouts. All work in `src/App.tsx`
(`TaskCard`, `WheelPicker`) and `src/index.css`. No data-layer changes;
what gets stored on completion is unchanged (stopwatch rounding, wheel
values 5–90 in 5-min steps, default = estimate snapped/clamped).

Shared rules for all three interaction states:

- The overlay is `absolute inset-0` (plus `overflow-hidden rounded-xl`), so it
  can never exceed the tile. The base tile keeps its natural height and stays
  rendered underneath with the existing `blur-[2px] opacity-60` treatment —
  the task name/bar shimmering through is the context; don't render
  `cardFace` inside the panels anymore.
- Controls float over the blurred tile (like today's Start/Complete buttons).
  Anything with small text (time readout, wheel) sits on its own solid
  rounded pill (`bg-white/95 dark:bg-neutral-900/95 shadow-sm ring-1
  ring-black/5 dark:ring-white/10`) for readability.
- Keep `panel-pop`, the fixed backdrop dismiss, single-active-card logic, and
  the reset-animation flow exactly as they are.

## Button style — ALL completion-flow buttons (frosted, no blue/green)

Drop the solid blue/green buttons entirely. Every button in the flow (Start,
Complete, both Done buttons) becomes a **frosted capsule with moderately
rounded corners** — NOT a full pill:

- `rounded-[10px]`, `border` with `border-black/5 dark:border-white/10`.
- Background: translucent card color + blur — `bg-white/60
  dark:bg-neutral-900/60 backdrop-blur-md` — so the blurred tile glows
  through.
- Text: `text-sm font-semibold text-neutral-900 dark:text-neutral-100`.
- Leading lucide icon, 15px: `Play` on Start (strokeWidth ~2.2), `Check` on
  Complete and on both Done buttons.
- Active state: raise background opacity (e.g. `active:bg-white/80
  dark:active:bg-neutral-900/80`) instead of a color shift.
- The pulsing blue stopwatch dot stays — it's the one small accent left.

## State 1 — prompt (Start / Complete)

Layout unchanged (already fits the tile) — only restyled per the button rules
above: `[▷ Start] [✓ Complete]`, both flex-1.

## State 2 — stopwatch

One horizontal row, vertically centered in the tile:

- Left: a solid pill with the pulsing blue dot + elapsed `M:SS`
  (`tabular-nums`, ~`text-xl font-bold`; keep the existing derived-from-
  `Date.now()` ticking).
- Right: a compact frosted **✓ Done** button (`px-5 py-2`, not full-width).
- `finishStopwatch` behavior unchanged.

## State 3 — duration picker → horizontal wheel

Convert the vertical `WheelPicker` into a **horizontal** scroll-snap wheel that
fits in one row inside the tile; keep the component name.

Layout: one row — the wheel (flex-1, inside a solid pill) + a compact frosted
**Done** button on the right showing the value (`✓ 25m`; keep it stable-width
with `tabular-nums`).

Wheel mechanics (mirror the vertical logic, axis-swapped):

- Constant item width `WHEEL_ITEM_W = 56` (rename from `WHEEL_ITEM_H`); row
  height ~40px. Container: `snap-x snap-mandatory overflow-x-scroll flex`
  with the existing `wheel-scroll` scrollbar hiding (add the horizontal case
  in `src/index.css` if needed).
- Leading/trailing spacer elements of width `calc(50% - 28px)` (half the
  container minus half an item, `shrink-0`) so the first and last values can
  center; each value cell is `shrink-0 snap-center` at `WHEEL_ITEM_W`.
- Selected (centered) value enlarged/bold/dark exactly like the vertical
  version; non-selected values smaller and muted. Show `min` only on the
  selected value (or drop it entirely and put the unit in the Done button) —
  horizontal space is tight.
- Selection band: a vertical strip of `WHEEL_ITEM_W` centered behind the
  wheel (the horizontal analog of today's centered row band).
- Edge fades: left/right gradients instead of top/bottom, fading FROM the
  pill's own background color — note the pill bg is semi-transparent white,
  so fade from `white`/`neutral-900` at 95% alpha or make the pill fully
  opaque to keep the gradients clean.
- **Keep the hard-won centering/reconcile logic**: initial centering via
  `useLayoutEffect` setting `scrollLeft = idx * WHEEL_ITEM_W`, re-asserted in
  a `requestAnimationFrame` (the panel is mid-`panel-pop` at mount), then a
  reconcile pass so the visually centered value, the highlight, and the Done
  button can never disagree. Same `handleScroll` rounding logic on
  `scrollLeft`.

## Cleanup + verification

- Remove now-dead vertical-wheel styling/constants; adjust the `wheel-scroll`
  CSS for horizontal use.
- Verify all three states visually contain themselves to the tile: open each
  on the FIRST and LAST card of the list (the old panel overflowed downward —
  make sure nothing clips oddly at list edges now), in light and dark mode.
- Verify wheel: opens centered on the estimate, swipes smoothly, snaps, Done
  logs the centered value; stopwatch: ticks visibly, Done stores the same
  rounded value as before; both still trigger the full reset animation +
  glide sequence.
- `npm run build` and `npm run lint` must pass.
- Verify frosted-button readability on top of a fully red (overdue) drop bar
  in both light and dark mode — bump the background opacity slightly if the
  labels get muddy.
- Update `CLAUDE.md`'s **Status** section for this change — AND it was not
  updated after the previous change (FLIP glide reorder + deferred write /
  'settled' phase), so bring it current on both: in-tile panels (blurred tile
  + floating controls, horizontal wheel, frosted monochrome buttons) and the
  completion sequence (drain → 3 blinks → beat → write → FLIP glide, anim
  cleared on `lastCompletedDate` change, view-toggle suppression).
