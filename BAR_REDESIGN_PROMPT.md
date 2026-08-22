# Claude Code prompt — cleaning "drop" bar redesign

Replace the current urgency progress bar with an SVG "drop" bar. Two decoupled
encodings on one shape:

- **Fill length = time until due** (absolute, on a shared log-time axis).
- **Outline + fill color = cycle state** (green → yellow across the cycle, red
  once overdue).
- **Drop length = the task's own cycle**, so a daily task is a short stub and a
  monthly one runs long.

Freshness is always visible because the thin colored outline shows even when the
fill is empty. Cards stay neutral (no card tint). Keep `logCompletion`, the
duration chips, and the Urgency/Rooms toggle unchanged.

## Axis + geometry (add to `src/lib/db.ts`)

SVG viewBox is `0 0 200 20` for every bar.

```ts
const MS_PER_DAY = 24 * 60 * 60 * 1000        // already exists
const X0 = 6.5                                 // today / left-cap center
const X_RIGHT = 197.25                          // axis right edge
const AXIS_D = Math.log(15) / 0.9               // log axis: 2 weeks = 90%

// day-offset -> 0..1 along the axis (today = 0, ~2 weeks ≈ 0.9, log-scaled)
export function axisFrac(days: number): number {
  return days <= 0 ? 0 : Math.min(1, Math.log(1 + days) / AXIS_D)
}

// 0..1 fraction -> x in viewBox units
const axisX = (frac: number) => X0 + frac * (X_RIGHT - X0)
```

Axis tick x-positions (for the legend + optional gridlines): `axisX(axisFrac(1))`
(1d), `axisX(axisFrac(7))` (1w), `axisX(axisFrac(14))` (2w).

## Drop outline path — `hornPath(cycleDays)`

Widest at today, gentle half-strength log taper to a thin rounded tip at the
cycle end, rounded caps at both ends.

```ts
export function hornPath(cycleDays: number): string {
  const H = 13, k = 1.5, cy = 10, xMax = X_RIGHT, R = H / 2, N = 46
  const xEnd = axisX(axisFrac(cycleDays))
  const h = (x: number) => H * Math.exp(-k * (x - X0) / (xMax - X0))
  const rr = Math.max(1.1, h(xEnd) / 2)
  const xB = xEnd - rr
  const xs = Array.from({ length: N + 1 }, (_, i) => X0 + (xB - X0) * (i / N))

  let d = `M ${X0.toFixed(1)} ${(cy - H / 2).toFixed(2)}`
  for (const x of xs) d += ` L ${x.toFixed(1)} ${(cy - h(x) / 2).toFixed(2)}`
  d += ` A ${rr.toFixed(2)} ${rr.toFixed(2)} 0 0 1 ${xB.toFixed(1)} ${(cy + h(xB) / 2).toFixed(2)}`
  for (let i = xs.length - 1; i >= 0; i--)
    d += ` L ${xs[i].toFixed(1)} ${(cy + h(xs[i]) / 2).toFixed(2)}`
  d += ` A ${R} ${R} 0 0 1 ${X0.toFixed(1)} ${(cy - H / 2).toFixed(2)} Z`
  return d
}
```

## Per-task values

```ts
// left edge of the time-fill on the axis; today (X0) once overdue
export function fillStartX(task: Task, now = new Date()): number {
  const daysUntilDue = msUntilDue(task, now) / MS_PER_DAY
  return axisX(axisFrac(Math.max(0, daysUntilDue)))
}

// cycle-state color: green -> yellow across the cycle, red once overdue
const GREEN = [94, 160, 46], YELLOW = [224, 165, 0], RED = [226, 75, 74]
const toHex = (c: number[]) =>
  '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t)

export function cycleColor(task: Task, now = new Date()): string {
  const pd = percentDue(task, now)
  if (pd >= 100) return toHex(RED)
  return toHex(mix(GREEN, YELLOW, pd / 100))
}

// darker shade for the outline (mix the state color toward black ~20%)
export function outlineColor(task: Task, now = new Date()): string {
  const pd = percentDue(task, now)
  const base = pd >= 100 ? RED : mix(GREEN, YELLOW, pd / 100)
  return toHex(mix(base, [0, 0, 0], 0.22))
}

// overdue by more than a whole cycle again -> heavier outline
export function severeOverdue(task: Task, now = new Date()): boolean {
  return percentDue(task, now) >= 200
}
```

Update `formatDueShort` to day-granularity only (no hours): overdue under a day
→ `"Today"`, else `"${n}d over"`; upcoming under a day → `"Today"`; else
`"${n}d"`.

## Bar in `src/App.tsx`

Replace the old `percentDue` progress-bar `<div>` with an inline SVG. Neutral
card. One `<clipPath>` per task (unique id, e.g. `fill-${task.id}`).

```tsx
const path = hornPath(task.frequencyDays)
const fill = cycleColor(task)
const stroke = outlineColor(task)
const sx = fillStartX(task)
const sw = severeOverdue(task) ? 0.9 : 0.7
```

```tsx
<svg viewBox="0 0 200 20" width="100%" className="block">
  <defs>
    <clipPath id={`fill-${task.id}`}>
      <rect x={sx} y={0} width={200} height={20} />
    </clipPath>
  </defs>
  {/* time fill: solid, same color, right-anchored to the cycle end */}
  <path d={path} fill={fill} clipPath={`url(#fill-${task.id})`} />
  {/* cycle-state outline: thin, always visible (shows freshness when empty) */}
  <path d={path} fill="none" stroke={stroke} strokeWidth={sw} />
</svg>
```

Above the list, render one axis legend row (`today` / `1d` / `1w` / `2w`) with
each label positioned at `axisX(axisFrac(d)) / 200 * 100%`, horizontally inset to
match the card padding so the ticks line up with the bars.

## Sorting

Sort both the flat Urgency list and the room groups (and the room ordering) by
`msUntilDue` **ascending** — most overdue first, then soonest-due — so the visual
order matches the bars.

## Notes / tunable knobs

- On this 2-week axis, cycles or due-dates beyond ~2 weeks pin near the right
  edge. Intentional: far-off tasks read as "not urgent," and 2-weeks vs 1-month
  are allowed to look similar.
- Constants worth leaving adjustable: taper `k` (1.5), axis anchor `AXIS_D`,
  color stops, and the severe-overdue threshold (200%).
- Color is an enhancement — fill length, outline, sort order, and the day badge
  should still read in grayscale (green↔red is the colorblind-collapse axis).

Run `npm run build` and `npm run lint`; both must pass.
