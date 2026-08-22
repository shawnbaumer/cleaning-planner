# Claude Code prompt — completion sequence + smooth list reorder (FLIP)

Two refinements to the task-completion flow in `src/App.tsx`. No data-layer
changes (`src/lib/db.ts` untouched), no new dependencies, storage behavior
unchanged.

Current behavior (after the last round of fixes): drain (~1400 ms, colors →
fresh green) → at the moment the blink phase starts, `logCompletion` fires →
the live query refreshes and the list re-sorts, so the card **teleports** to
its new position while still blinking. Two problems: the move happens during
the blinks instead of after them, and the move itself is an instant jump.

## Change 1 — sequence: full animation first, then the move

New order: **drain → all 3 blinks in place → short beat (~200 ms) → DB write
lands → cards glide to their new positions** (Change 2).

- Move the deferred `logCompletion` from blink-start to *after* the final
  blink iteration plus a ~200 ms pause.
- Critical detail: `anim` must NOT clear before the DB refresh lands,
  otherwise the card face briefly flashes back to its old (e.g. red/overdue)
  live state between animation end and the live-query update. Add a final
  phase (e.g. `'settled'`) that keeps rendering the captured fresh-green
  empty-drop state after the blinks; clear `anim` only once the `task` prop
  actually reflects the completion — watch `task.lastCompletedDate` change in
  an effect, rather than using a timer, so it's deterministic. (A generous
  timeout fallback, e.g. 2 s after the write, is fine as a safety net in case
  the write fails.)
- Keep the existing exactly-once guard: if the card unmounts mid-animation
  (view toggle), the completion must still be logged once — that now includes
  the case where unmount happens before the new, later write moment.

## Change 2 — FLIP glide instead of teleport

Add a small dependency-free FLIP hook so that whenever the task lists re-sort,
cards glide to their new positions (~550 ms, gentle ease like
`cubic-bezier(0.25, 0.8, 0.25, 1)`) instead of jumping. Applies to BOTH views
(Urgency flat list and Rooms grouped lists).

Sketch (adapt as needed):

```tsx
function useFlip(enabled: boolean) {
  const refs = useRef(new Map<number, HTMLElement>())
  const prev = useRef(new Map<number, number>())

  useLayoutEffect(() => {
    const moves: Array<[HTMLElement, number]> = []
    refs.current.forEach((el, id) => {
      const top = el.offsetTop            // offsetTop, NOT getBoundingClientRect:
      const old = prev.current.get(id)    // immune to scroll position
      if (enabled && old !== undefined && Math.abs(old - top) > 1) {
        moves.push([el, old - top])
      }
      prev.current.set(id, top)
    })
    moves.forEach(([el, dy]) => {
      el.style.transition = 'none'
      el.style.transform = `translateY(${dy}px)`
    })
    if (moves.length) void document.body.offsetHeight // force reflow
    moves.forEach(([el]) => {
      el.style.transition = 'transform 550ms cubic-bezier(0.25, 0.8, 0.25, 1)'
      el.style.transform = ''
      el.addEventListener(
        'transitionend',
        () => { el.style.transition = ''; el.style.transform = '' },
        { once: true },
      )
    })
  })

  // ref factory for each task's <li>
  return (id: number) => (el: HTMLElement | null) => {
    if (el) refs.current.set(id, el)
    else refs.current.delete(id)
  }
}
```

Implementation notes:

- `TaskCard` renders the `<li>`, so pass the ref down as a prop (e.g.
  `flipRef`) from `renderTask` and attach it to the `<li>`.
- Suppress the glide when it would be wrong: on initial mount (no `prev`
  entries — already handled) and on a **view-mode toggle** (clear the `prev`
  map when `viewMode` changes so switching Urgency ↔ Rooms doesn't animate a
  fake reshuffle). The DEV 🎲 Randomize button MAY glide — that's a nice test.
- The completed card itself glides down while the cards below glide up; by
  this point the card shows its live fresh state, which is correct.
- A card mid-glide must still be tappable-safe: transforms on the `<li>` are
  fine, but make sure the open-panel `z-30` logic still works if a panel opens
  during someone else's glide (transforms create stacking contexts — verify
  the active card still renders above its neighbors; bump z-indexes if
  needed).

## Resulting timeline (for verification)

tap Done → drain 1400 ms (card in place) → 3 blinks × 380 ms (card in place)
→ ~200 ms beat → write lands → all affected cards glide ~550 ms → done.
Total ≈ 3.3 s from tap to settled list.

(If the user later prefers the move interleaved between blink 1 and blinks
2–3, only the write moment shifts — the FLIP machinery is identical. Do not
implement that variant now.)

Verify in dev with 🎲 Randomize: complete an overdue task near the top of the
Urgency list and watch the full sequence; also verify in Rooms view, where the
room *sections* may also reorder (section headers jumping without a glide is
acceptable for now — note it in CLAUDE.md if so).

## Wrap-up

- `npm run build` and `npm run lint` must both pass.
- Update `CLAUDE.md`'s **Status** section: completion sequence (write deferred
  until after all blinks + beat, anim cleared on `lastCompletedDate` change)
  and the FLIP glide reorder (both views, suppressed on view toggle).
