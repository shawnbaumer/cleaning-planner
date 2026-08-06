import { useLayoutEffect, useRef } from 'react'
import { Plus, Minus, Check, Sparkles, Moon, CircleAlert, type LucideIcon } from 'lucide-react'
import type { FloorType, RoomType, SizeClass, WindowCount } from '../lib/db'
import { LIB, TYPE_META, WHEEL_ROOM_TYPES, SIZES, WINDOWS, FLOORS, fmtFreq, type TaskStatus } from '../lib/library'
import { resolveIcon } from '../lib/icons'

// ---------------------------------------------------------------------------
// Shared style tokens — matches the main app's card/CTA conventions
// (rounded-xl white/neutral-900 cards, black-inverted primary CTA). Shared
// between the setup wizard (Wizard.tsx) and the post-setup home-management
// screen (Manage.tsx) so the two surfaces read as one visual language.
// ---------------------------------------------------------------------------

export const CARD = 'rounded-xl bg-white shadow-sm ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10'
export const CTA =
  'block w-full rounded-xl bg-neutral-900 py-3.5 text-center text-[15px] font-semibold text-white transition active:bg-neutral-700 disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900 dark:active:bg-neutral-300'
export const CTA_GHOST = `block w-full rounded-xl ${CARD} py-3.5 text-center text-[15px] font-semibold text-neutral-900 dark:text-neutral-100`

// Cycle-state colors — the exact GREEN/YELLOW/RED from db.ts's cycleColor, so
// the Fresh/Due soon/Overdue chips read as the same visual language as the
// main list's drop bars.
export const GOOD = '#5ea02e'
export const SOSO = '#e0a500'
export const UGLY = '#e24b4a'

export const STATUS_ICON: Record<TaskStatus, LucideIcon> = { fresh: Sparkles, soon: Moon, overdue: CircleAlert }
export const STATUS_LABEL: Record<TaskStatus, string> = { fresh: 'Fresh', soon: 'Due soon', overdue: 'Overdue' }
export const STATUS_COLOR: Record<TaskStatus, string> = { fresh: GOOD, soon: SOSO, overdue: UGLY }

export function EquipIcon({ name, className }: { name: string; className?: string }) {
  const Icon = resolveIcon(name) ?? Sparkles
  return <Icon className={className} strokeWidth={1.8} aria-hidden="true" />
}

// ---------------------------------------------------------------------------
// Toggle row — home-profile toggles (Pets/Plants/WFH) and room-select rows.
// ---------------------------------------------------------------------------

export function ToggleRow({
  icon: Icon,
  label,
  on,
  onToggle,
}: {
  icon: LucideIcon
  label: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`mb-2 flex w-full items-center gap-3 ${CARD} px-3.5 py-3.5 text-left`}
    >
      <Icon className="h-5 w-5 shrink-0 text-neutral-500 dark:text-neutral-400" strokeWidth={1.8} aria-hidden="true" />
      <span className="flex-1 text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{label}</span>
      <span
        className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors ${on ? '' : 'bg-neutral-200 dark:bg-neutral-700'}`}
        style={on ? { backgroundColor: GOOD } : undefined}
      >
        <span
          className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[21px]' : 'left-[3px]'}`}
        />
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Frequency +/− stepper. `suggested` is derived (never stored) — pass null
// to suppress the "suggested" line entirely (renamed/own tasks).
// ---------------------------------------------------------------------------

export function FreqStepper({
  value,
  suggested,
  onDec,
  onInc,
}: {
  value: number
  suggested: number | null
  onDec: () => void
  onInc: () => void
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-neutral-100 p-1.5 dark:bg-neutral-800">
      <button
        type="button"
        onClick={onDec}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-black/5 bg-white text-neutral-900 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="flex-1 text-center">
        <div className="text-[14.5px] font-bold text-neutral-900 dark:text-neutral-100">{fmtFreq(value)}</div>
        {suggested !== null &&
          (value !== suggested ? (
            <div className="text-[10.5px] font-semibold" style={{ color: SOSO }}>
              suggested {fmtFreq(suggested)}
            </div>
          ) : (
            <div className="text-[10.5px] font-medium text-neutral-400 dark:text-neutral-500">suggested</div>
          ))}
      </div>
      <button
        type="button"
        onClick={onInc}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-black/5 bg-white text-neutral-900 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fresh / Due soon / Overdue state chips.
// ---------------------------------------------------------------------------

export function StatusChips({ status, onChange }: { status: TaskStatus; onChange: (s: TaskStatus) => void }) {
  return (
    <div className="flex gap-1.5">
      {(['fresh', 'soon', 'overdue'] as const).map((s) => {
        const StatusIcon = STATUS_ICON[s]
        const selected = status === s
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className="flex-1 rounded-lg border px-2 py-2 text-center text-[11.5px] font-semibold"
            style={
              selected
                ? { borderColor: STATUS_COLOR[s], backgroundColor: `${STATUS_COLOR[s]}20`, color: STATUS_COLOR[s] }
                : undefined
            }
          >
            <StatusIcon
              className={`mx-auto mb-1 h-4 w-4 ${selected ? '' : 'text-neutral-400 dark:text-neutral-500'}`}
              style={selected ? { color: STATUS_COLOR[s] } : undefined}
              aria-hidden="true"
            />
            <span className={selected ? '' : 'text-neutral-500 dark:text-neutral-400'}>{STATUS_LABEL[s]}</span>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// A decided (added) suggestion, stacked compactly above the current
// task-decide card.
// ---------------------------------------------------------------------------

export function DecidedTaskRow({
  name,
  frequencyDays,
  durationMinutes,
  status,
}: {
  name: string
  frequencyDays: number
  durationMinutes: number
  status: TaskStatus
}) {
  const StatusIcon = STATUS_ICON[status]
  return (
    <div className={`mb-1.5 flex items-center gap-2.5 ${CARD} px-3 py-2`}>
      <StatusIcon className="h-4 w-4 shrink-0" style={{ color: STATUS_COLOR[status] }} aria-hidden="true" />
      <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
        {name}
        <span className="ml-1.5 text-[11px] font-normal text-neutral-400 dark:text-neutral-500">
          {fmtFreq(frequencyDays)} · ~{durationMinutes}m
        </span>
      </div>
      <Check className="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" aria-hidden="true" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// The task-by-task decide card: name, duration/index, freq stepper, status
// chips, Skip/Add. Shared by the wizard's TasksScreen and Manage's re-decide
// screen.
// ---------------------------------------------------------------------------

export function TaskDecideCard({
  name,
  durationMinutes,
  indexLabel,
  frequencyDays,
  suggestedFrequencyDays,
  onStepFreq,
  status,
  onSetStatus,
  onSkip,
  onAdd,
}: {
  name: string
  durationMinutes: number
  indexLabel: string
  frequencyDays: number
  suggestedFrequencyDays: number | null
  onStepFreq: (dir: 1 | -1) => void
  status: TaskStatus
  onSetStatus: (s: TaskStatus) => void
  onSkip: () => void
  onAdd: () => void
}) {
  return (
    <div className={`${CARD} mt-2.5 p-4`}>
      <div className="text-[17px] font-bold text-neutral-900 dark:text-neutral-100">{name}</div>
      <div className="mb-3 mt-0.5 text-[12px] text-neutral-400 dark:text-neutral-500">
        takes about {durationMinutes} min · {indexLabel}
      </div>

      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        How often?
      </div>
      <FreqStepper
        value={frequencyDays}
        suggested={suggestedFrequencyDays}
        onDec={() => onStepFreq(-1)}
        onInc={() => onStepFreq(1)}
      />

      <div className="mb-1.5 mt-3 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        State right now
      </div>
      <StatusChips status={status} onChange={onSetStatus} />

      <div className="mt-3.5 flex gap-2">
        <button type="button" onClick={onSkip} className={`flex-1 ${CTA_GHOST}`}>
          Skip
        </button>
        <button type="button" onClick={onAdd} className={`flex-1 ${CTA}`}>
          Add task
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Room-type wheel — the "add another room" horizontal scroll-snap picker.
// Same centering/reconcile pattern as the main app's duration WheelPicker
// (App.tsx), adapted for text labels instead of numbers.
// ---------------------------------------------------------------------------

export const ROOM_WHEEL_ITEM_W = 116
export const ROOM_WHEEL_ROW_H = 40

export function RoomTypeWheel({ index, onChange }: { index: number; onChange: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)

  const handleScroll = () => {
    const el = ref.current
    if (!el) return
    const idx = Math.min(
      WHEEL_ROOM_TYPES.length - 1,
      Math.max(0, Math.round(el.scrollLeft / ROOM_WHEEL_ITEM_W)),
    )
    if (idx !== index) onChange(idx)
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.scrollLeft = index * ROOM_WHEEL_ITEM_W
    const raf = requestAnimationFrame(() => {
      el.scrollLeft = index * ROOM_WHEEL_ITEM_W
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="relative flex-1 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800"
      style={{ height: ROOM_WHEEL_ROW_H }}
    >
      <div
        className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-md bg-white shadow-sm dark:bg-neutral-950"
        style={{ width: ROOM_WHEEL_ITEM_W - 8 }}
        aria-hidden="true"
      />
      <div
        ref={ref}
        onScroll={handleScroll}
        className="wheel-scroll relative flex h-full snap-x snap-mandatory overflow-x-scroll"
      >
        <div className="shrink-0" style={{ width: `calc(50% - ${ROOM_WHEEL_ITEM_W / 2}px)` }} />
        {WHEEL_ROOM_TYPES.map((type, i) => (
          <div
            key={type}
            className={`flex h-full shrink-0 snap-center items-center justify-center whitespace-nowrap px-1 text-center transition-colors ${
              i === index
                ? 'text-[13px] font-bold text-neutral-900 dark:text-neutral-100'
                : 'text-[13px] font-medium text-neutral-400 dark:text-neutral-600'
            }`}
            style={{ width: ROOM_WHEEL_ITEM_W }}
          >
            {TYPE_META[type]}
          </div>
        ))}
        <div className="shrink-0" style={{ width: `calc(50% - ${ROOM_WHEEL_ITEM_W / 2}px)` }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Per-room config accordion — size / windows / floor / equipment. Shared by
// the wizard's per-room setup (steps advance as answered, `openStep` is
// always non-null while the screen is showing) and Manage's config re-edit
// (all steps start compact/answered, `openStep` is null until a row is
// tapped, and reopening/answering collapses back to null — no forced
// re-walk). The two modes differ only in what the caller passes for
// `openStep`/`compactSteps` and the equipment step's CTA.
// ---------------------------------------------------------------------------

export type ConfigStep = 'size' | 'windows' | 'floor' | 'equipment'

export function cfgSteps(type: RoomType): ConfigStep[] {
  return LIB[type].noFloor ? ['size', 'windows', 'equipment'] : ['size', 'windows', 'floor', 'equipment']
}

export const STEP_LABEL: Record<ConfigStep, string> = { size: 'Size', windows: 'Windows', floor: 'Floor', equipment: 'Inside' }

/** The room-shaped data the config accordion needs — satisfied by both the wizard's DraftRoom and Manage's editable room draft. */
export interface ConfigRoomDraft {
  type: RoomType
  name: string
  sizeClass: SizeClass | null
  windows: WindowCount | null
  floor: FloorType
  /** Library equipment keys, plus free-text custom items prefixed `custom:`. */
  equipment: string[]
}

/** "Medium · 1 window · Hard floor" — the compact setup summary line shown on a room card/row (no size range, unlike compactValue's own 'size' line). */
export function roomSetLine(room: ConfigRoomDraft): string {
  return [
    SIZES.find((s) => s.key === room.sizeClass)?.label,
    WINDOWS.find((w) => w.count === room.windows)?.label,
    !LIB[room.type].noFloor ? FLOORS.find((f) => f.key === room.floor)?.label : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function compactValue(room: ConfigRoomDraft, step: ConfigStep): string {
  if (step === 'size') {
    const s = SIZES.find((s) => s.key === room.sizeClass)
    return s ? `${s.label} · ${s.range}` : ''
  }
  if (step === 'windows') return WINDOWS.find((w) => w.count === room.windows)?.label ?? ''
  if (step === 'floor') return FLOORS.find((f) => f.key === room.floor)?.label ?? ''
  const labels = room.equipment.map((k) =>
    k.startsWith('custom:') ? k.slice(7) : (LIB[room.type].equipment.find((e) => e.key === k)?.label ?? k),
  )
  return labels.length ? labels.join(', ') : 'Empty'
}

export function AnsweredRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <button type="button" onClick={onEdit} className={`mb-1.5 flex w-full items-center gap-2.5 ${CARD} px-3 py-2.5 text-left`}>
      <span className="w-16 shrink-0 text-[11px] font-semibold text-neutral-400 dark:text-neutral-500">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{value}</span>
      <span className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">edit</span>
    </button>
  )
}

export function RoomConfigAccordion({
  room,
  openStep,
  compactSteps,
  onAnswer,
  onReopen,
  toggleEquip,
  showEquipAdd,
  setShowEquipAdd,
  customEquipName,
  setCustomEquipName,
  addCustomEquip,
  removeCustomEquip,
  equipCtaLabel,
  onEquipCta,
}: {
  room: ConfigRoomDraft
  openStep: ConfigStep | null
  compactSteps: ConfigStep[]
  onAnswer: (step: 'size' | 'windows' | 'floor', value: SizeClass | WindowCount | NonNullable<FloorType>) => void
  onReopen: (step: ConfigStep) => void
  toggleEquip: (key: string) => void
  showEquipAdd: boolean
  setShowEquipAdd: (v: boolean) => void
  customEquipName: string
  setCustomEquipName: (v: string) => void
  addCustomEquip: () => void
  removeCustomEquip: (key: string) => void
  equipCtaLabel: string
  onEquipCta: () => void
}) {
  const lib = LIB[room.type]

  return (
    <>
      {compactSteps.map((step) => (
        <AnsweredRow key={step} label={STEP_LABEL[step]} value={compactValue(room, step)} onEdit={() => onReopen(step)} />
      ))}

      {openStep && (
        <div className={`${CARD} mt-2.5 p-4`}>
          {openStep === 'size' && (
            <>
              <h3 className="mb-3 text-[16px] font-bold text-neutral-900 dark:text-neutral-100">How big is {room.name}?</h3>
              <div className="flex flex-wrap gap-1.5">
                {SIZES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => onAnswer('size', s.key)}
                    className="rounded-lg border border-black/5 bg-neutral-50 px-3.5 py-2.5 text-left text-[13.5px] font-semibold text-neutral-900 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-100"
                  >
                    {s.label}
                    <span className="block text-[10.5px] font-normal text-neutral-400 dark:text-neutral-500">{s.range}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {openStep === 'windows' && (
            <>
              <h3 className="mb-3 text-[16px] font-bold text-neutral-900 dark:text-neutral-100">Windows?</h3>
              <div className="flex flex-wrap gap-1.5">
                {WINDOWS.map((w) => (
                  <button
                    key={w.count}
                    type="button"
                    onClick={() => onAnswer('windows', w.count)}
                    className="rounded-lg border border-black/5 bg-neutral-50 px-3.5 py-2.5 text-[13.5px] font-semibold text-neutral-900 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-100"
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {openStep === 'floor' && (
            <>
              <h3 className="mb-3 text-[16px] font-bold text-neutral-900 dark:text-neutral-100">What's on the floor?</h3>
              <div className="flex flex-wrap gap-1.5">
                {FLOORS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => onAnswer('floor', f.key)}
                    className="rounded-lg border border-black/5 bg-neutral-50 px-3.5 py-2.5 text-left text-[13.5px] font-semibold text-neutral-900 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-100"
                  >
                    {f.label}
                    <span className="block text-[10.5px] font-normal text-neutral-400 dark:text-neutral-500">{f.description}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {openStep === 'equipment' && (
            <>
              <h3 className="mb-3 text-[16px] font-bold text-neutral-900 dark:text-neutral-100">What's in here?</h3>
              <div className="grid grid-cols-2 gap-2">
                {lib.equipment.map((e) => {
                  const selected = room.equipment.includes(e.key)
                  return (
                    <button
                      key={e.key}
                      type="button"
                      onClick={() => toggleEquip(e.key)}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center ${
                        selected
                          ? 'border-neutral-900 bg-neutral-900 text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900'
                          : 'border-black/5 bg-neutral-50 text-neutral-900 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-100'
                      }`}
                    >
                      <EquipIcon name={e.icon} className="h-5 w-5" />
                      <span className="text-[12.5px] font-semibold">{e.label}</span>
                    </button>
                  )
                })}
                {room.equipment
                  .filter((k) => k.startsWith('custom:'))
                  .map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => removeCustomEquip(k)}
                      className="flex flex-col items-center gap-1.5 rounded-xl border border-neutral-900 bg-neutral-900 px-2 py-3 text-center text-white dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900"
                    >
                      <Sparkles className="h-5 w-5" aria-hidden="true" />
                      <span className="text-[12.5px] font-semibold">{k.slice(7)}</span>
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => setShowEquipAdd(!showEquipAdd)}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-black/15 bg-neutral-50 px-2 py-3 text-center text-neutral-500 dark:border-white/15 dark:bg-neutral-800 dark:text-neutral-400"
                >
                  <Plus className="h-5 w-5" aria-hidden="true" />
                  <span className="text-[12.5px] font-semibold">Add</span>
                </button>
              </div>

              {showEquipAdd && (
                <div className="mt-2.5 flex gap-1.5">
                  <input
                    autoFocus
                    value={customEquipName}
                    onChange={(e) => setCustomEquipName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addCustomEquip()}
                    placeholder="e.g. Aquarium, piano…"
                    className="flex-1 rounded-lg border border-black/5 bg-neutral-50 px-3 py-2 text-[13.5px] text-neutral-900 outline-none dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                  <button
                    type="button"
                    onClick={addCustomEquip}
                    className="rounded-lg bg-neutral-900 px-4 text-[13px] font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900"
                  >
                    Add
                  </button>
                </div>
              )}

              <button type="button" onClick={onEquipCta} className={`${CTA} mt-3`}>
                {equipCtaLabel}
              </button>
            </>
          )}
        </div>
      )}
    </>
  )
}
