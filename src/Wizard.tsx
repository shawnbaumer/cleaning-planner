import { useLayoutEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  Plus,
  X,
  Check,
  Minus,
  PawPrint,
  Sprout as SproutIcon,
  Laptop,
  Sparkles,
  Moon,
  CircleAlert,
  type LucideIcon,
} from 'lucide-react'
import { db, type FloorType, type RoomType, type SizeClass, type WindowCount } from './lib/db'
import {
  LIB,
  TYPE_META,
  DEFAULT_ROOM_TYPES,
  WHEEL_ROOM_TYPES,
  SIZES,
  WINDOWS,
  FLOORS,
  FREQ_STEPS,
  fmtFreq,
  buildTasks,
  baselineLastCompletedDate,
  type HomeProfile,
  type SuggestedTask,
  type TaskStatus,
} from './lib/library'
import { resolveIcon, roomIcon } from './lib/icons'

// ---------------------------------------------------------------------------
// Shared style tokens — matches the main app's card/CTA conventions
// (rounded-xl white/neutral-900 cards, black-inverted primary CTA).
// ---------------------------------------------------------------------------

const CARD = 'rounded-xl bg-white shadow-sm ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10'
const CTA =
  'block w-full rounded-xl bg-neutral-900 py-3.5 text-center text-[15px] font-semibold text-white transition active:bg-neutral-700 disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900 dark:active:bg-neutral-300'
const CTA_GHOST = `block w-full rounded-xl ${CARD} py-3.5 text-center text-[15px] font-semibold text-neutral-900 dark:text-neutral-100`

// Cycle-state colors — the exact GREEN/YELLOW/RED from db.ts's cycleColor, so
// the wizard's Fresh/Due soon/Overdue chips read as the same visual language
// as the main list's drop bars.
const GOOD = '#5ea02e'
const SOSO = '#e0a500'
const UGLY = '#e24b4a'

const STATUS_ICON: Record<TaskStatus, LucideIcon> = { fresh: Sparkles, soon: Moon, overdue: CircleAlert }
const STATUS_LABEL: Record<TaskStatus, string> = { fresh: 'Fresh', soon: 'Due soon', overdue: 'Overdue' }
const STATUS_COLOR: Record<TaskStatus, string> = { fresh: GOOD, soon: SOSO, overdue: UGLY }

function EquipIcon({ name, className }: { name: string; className?: string }) {
  const Icon = resolveIcon(name) ?? Sparkles
  return <Icon className={className} strokeWidth={1.8} aria-hidden="true" />
}

// ---------------------------------------------------------------------------
// Wizard-local draft state — mirrors the approved mockup's `state.rooms`
// shape, but with nullable answer fields so "answered vs. not yet" is
// explicit (see cfgSteps/answerStep below).
// ---------------------------------------------------------------------------

type Screen = 'profile' | 'roomselect' | 'config' | 'tasks' | 'overview'
type ConfigStep = 'size' | 'windows' | 'floor' | 'equipment'

interface DraftRoom {
  type: RoomType
  name: string
  sizeClass: SizeClass | null
  windows: WindowCount | null
  /** null = unanswered (or permanently "no floor" for noFloor room types). */
  floor: FloorType
  /** Library equipment keys, plus free-text custom items prefixed `custom:`. */
  equipment: string[]
  tasks: SuggestedTask[]
}

function cfgSteps(type: RoomType): ConfigStep[] {
  return LIB[type].noFloor ? ['size', 'windows', 'equipment'] : ['size', 'windows', 'floor', 'equipment']
}

function emptyDraftRoom(type: RoomType, name: string): DraftRoom {
  return { type, name, sizeClass: null, windows: null, floor: null, equipment: [], tasks: [] }
}

// ---------------------------------------------------------------------------
// Room-type wheel — the "add another room" horizontal scroll-snap picker.
// Same centering/reconcile pattern as the main app's duration WheelPicker
// (App.tsx), adapted for text labels instead of numbers.
// ---------------------------------------------------------------------------

const ROOM_WHEEL_ITEM_W = 116
const ROOM_WHEEL_ROW_H = 40

function RoomTypeWheel({ index, onChange }: { index: number; onChange: (i: number) => void }) {
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

export default function Wizard() {
  const [screen, setScreen] = useState<Screen>('profile')

  const [profile, setProfile] = useState<HomeProfile>({ pets: true, plants: true, wfh: false })

  const [defaultSel, setDefaultSel] = useState<Record<RoomType, boolean>>(
    () => Object.fromEntries(DEFAULT_ROOM_TYPES.map((t) => [t, true])) as Record<RoomType, boolean>,
  )
  const [extraRooms, setExtraRooms] = useState<Array<{ type: RoomType; label: string }>>([])
  const [wheelIdx, setWheelIdx] = useState(0)

  const [rooms, setRooms] = useState<DraftRoom[]>([])
  const [curRoomIndex, setCurRoomIndex] = useState(0)
  const [cfgStep, setCfgStep] = useState(0)
  const [ti, setTi] = useState(0)
  const [showEquipAdd, setShowEquipAdd] = useState(false)
  const [customEquipName, setCustomEquipName] = useState('')
  const [ownTaskName, setOwnTaskName] = useState('')
  const [ownFreq, setOwnFreq] = useState(7)
  const [expandedOverviewRooms, setExpandedOverviewRooms] = useState<Set<number>>(new Set())
  const [building, setBuilding] = useState(false)

  const room = rooms[curRoomIndex] as DraftRoom | undefined

  // -- navigation -----------------------------------------------------------

  const showBack = screen !== 'profile'

  function goBack() {
    if (screen === 'roomselect') {
      setScreen('profile')
      return
    }
    if (screen === 'config') {
      if (cfgStep > 0) {
        setCfgStep(cfgStep - 1)
        return
      }
      if (curRoomIndex > 0) {
        const prevIdx = curRoomIndex - 1
        setCurRoomIndex(prevIdx)
        setTi(rooms[prevIdx].tasks.length)
        setScreen('tasks')
        return
      }
      setScreen('roomselect')
      return
    }
    if (screen === 'tasks') {
      if (ti > 0) {
        setTi(ti - 1)
        return
      }
      setCfgStep(cfgSteps(rooms[curRoomIndex].type).length - 1)
      setScreen('config')
      return
    }
    if (screen === 'overview') {
      const lastIdx = rooms.length - 1
      setCurRoomIndex(lastIdx)
      setTi(rooms[lastIdx].tasks.length)
      setScreen('tasks')
    }
  }

  // -- room selection ---------------------------------------------------

  const selectedRoomCount = DEFAULT_ROOM_TYPES.filter((t) => defaultSel[t]).length + extraRooms.length

  function addExtraRoom() {
    const type = WHEEL_ROOM_TYPES[wheelIdx]
    const existingCount =
      (DEFAULT_ROOM_TYPES.includes(type) && defaultSel[type] ? 1 : 0) +
      extraRooms.filter((e) => e.type === type).length
    const label = existingCount ? `${TYPE_META[type]} ${existingCount + 1}` : TYPE_META[type]
    setExtraRooms((prev) => [...prev, { type, label }])
  }

  // Builds the room list from the current selection. Reused both for the
  // first "Continue with N rooms" and for returning from the overview's
  // "+ Add or remove rooms" — matching by name preserves any room that's
  // already been configured instead of discarding it.
  function continueToRoomConfig() {
    const selected: Array<{ type: RoomType; name: string }> = [
      ...DEFAULT_ROOM_TYPES.filter((t) => defaultSel[t]).map((t) => ({ type: t, name: TYPE_META[t] })),
      ...extraRooms.map((e) => ({ type: e.type, name: e.label })),
    ]
    setRooms((prev) => {
      const byName = new Map(prev.map((r) => [r.name, r]))
      return selected.map((r) => byName.get(r.name) ?? emptyDraftRoom(r.type, r.name))
    })
    setCurRoomIndex(0)
    setCfgStep(0)
    setScreen('config')
  }

  // -- per-room config accordion ------------------------------------------

  function answerStep(step: 'size' | 'windows' | 'floor', value: SizeClass | WindowCount | NonNullable<FloorType>) {
    if (!room) return
    const updated: DraftRoom = {
      ...room,
      ...(step === 'size' ? { sizeClass: value as SizeClass } : {}),
      ...(step === 'windows' ? { windows: value as WindowCount } : {}),
      ...(step === 'floor' ? { floor: value as FloorType } : {}),
    }
    const steps = cfgSteps(updated.type)
    let next = steps.length - 1
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      if (s === 'size' && updated.sizeClass === null) {
        next = i
        break
      }
      if (s === 'windows' && updated.windows === null) {
        next = i
        break
      }
      if (s === 'floor' && updated.floor === null) {
        next = i
        break
      }
    }
    setRooms((prev) => prev.map((r, i) => (i === curRoomIndex ? updated : r)))
    setCfgStep(next)
  }

  function reopenStep(step: ConfigStep) {
    if (!room) return
    setCfgStep(cfgSteps(room.type).indexOf(step))
  }

  function toggleEquip(key: string) {
    setRooms((prev) =>
      prev.map((r, i) =>
        i === curRoomIndex
          ? { ...r, equipment: r.equipment.includes(key) ? r.equipment.filter((k) => k !== key) : [...r.equipment, key] }
          : r,
      ),
    )
  }

  function addCustomEquip() {
    const name = customEquipName.trim()
    if (!name) return
    setRooms((prev) => prev.map((r, i) => (i === curRoomIndex ? { ...r, equipment: [...r.equipment, `custom:${name}`] } : r)))
    setCustomEquipName('')
    setShowEquipAdd(false)
  }

  function removeCustomEquip(key: string) {
    setRooms((prev) => prev.map((r, i) => (i === curRoomIndex ? { ...r, equipment: r.equipment.filter((k) => k !== key) } : r)))
  }

  function confirmEquipAndBuildTasks() {
    if (!room) return
    const tasks = buildTasks(
      { type: room.type, sizeClass: room.sizeClass ?? 'M', windows: room.windows ?? 0, floor: room.floor, equipment: room.equipment },
      profile,
    )
    setRooms((prev) => prev.map((r, i) => (i === curRoomIndex ? { ...r, tasks } : r)))
    setShowEquipAdd(false)
    setTi(0)
    setScreen('tasks')
  }

  // -- task-by-task -----------------------------------------------------

  function updateCurTasks(fn: (tasks: SuggestedTask[]) => SuggestedTask[]) {
    setRooms((prev) => prev.map((r, i) => (i === curRoomIndex ? { ...r, tasks: fn(r.tasks) } : r)))
  }

  function stepFreq(dir: 1 | -1) {
    updateCurTasks((tasks) => {
      const t = tasks[ti]
      let fi = FREQ_STEPS.indexOf(t.frequencyDays)
      if (fi < 0) fi = FREQ_STEPS.findIndex((s) => s >= t.frequencyDays)
      fi = Math.min(FREQ_STEPS.length - 1, Math.max(0, fi + dir))
      return tasks.map((x, i) => (i === ti ? { ...x, frequencyDays: FREQ_STEPS[fi] } : x))
    })
  }

  function setTaskStatus(status: TaskStatus) {
    updateCurTasks((tasks) => tasks.map((x, i) => (i === ti ? { ...x, status } : x)))
  }

  function decideTask(added: boolean) {
    updateCurTasks((tasks) => tasks.map((x, i) => (i === ti ? { ...x, added } : x)))
    setTi(ti + 1)
  }

  function stepOwnFreq(dir: 1 | -1) {
    let fi = FREQ_STEPS.indexOf(ownFreq)
    fi = Math.min(FREQ_STEPS.length - 1, Math.max(0, fi + dir))
    setOwnFreq(FREQ_STEPS[fi])
  }

  function addOwnTask() {
    const name = ownTaskName.trim()
    if (!name) return
    updateCurTasks((tasks) => [
      ...tasks,
      { name, frequencyDays: ownFreq, suggestedFrequencyDays: ownFreq, durationMinutes: 10, icon: 'Sparkles', status: 'soon', added: true },
    ])
    // Keep ti pointing one past the end (tasks.length just grew by one) so the
    // just-added task isn't immediately re-served as an undecided suggestion —
    // this keeps the own-task screen showing, ready to add another.
    setTi(ti + 1)
    setOwnTaskName('')
    setOwnFreq(7)
  }

  function finishRoom() {
    if (curRoomIndex + 1 < rooms.length) {
      setCurRoomIndex(curRoomIndex + 1)
      setCfgStep(0)
      setTi(0)
      setScreen('config')
    } else {
      setScreen('overview')
    }
  }

  // -- overview -----------------------------------------------------------

  function editRoom(i: number) {
    setCurRoomIndex(i)
    setCfgStep(0)
    setScreen('config')
  }

  function toggleOverviewExpanded(i: number) {
    setExpandedOverviewRooms((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  async function buildHome() {
    setBuilding(true)
    const now = Date.now()
    try {
      await db.transaction('rw', db.homes, db.rooms, db.tasks, async () => {
        const homeId = await db.homes.add({ name: 'Home', pets: profile.pets, plants: profile.plants, wfh: profile.wfh })
        for (const r of rooms) {
          const roomId = await db.rooms.add({
            homeId,
            name: r.name,
            type: r.type,
            sizeClass: r.sizeClass ?? 'M',
            windows: r.windows ?? 0,
            floor: LIB[r.type].noFloor ? null : r.floor,
            equipment: r.equipment,
          })
          for (const t of r.tasks.filter((t) => t.added)) {
            await db.tasks.add({
              roomId,
              name: t.name,
              frequencyDays: t.frequencyDays,
              estimatedDurationMinutes: t.durationMinutes,
              lastCompletedDate: baselineLastCompletedDate(t.frequencyDays, t.status, now),
              icon: t.icon,
            })
          }
        }
      })
      // App's useLiveQuery on db.rooms picks this up and swaps away from the
      // wizard automatically — no local state transition needed here.
    } catch (err) {
      setBuilding(false)
      throw err
    }
  }

  // -- header ---------------------------------------------------------------

  const title =
    screen === 'profile' || screen === 'roomselect'
      ? 'Set up your home'
      : screen === 'config' && room
        ? `${room.name} · ${curRoomIndex + 1}/${rooms.length}`
        : screen === 'tasks' && room
          ? `${room.name} · tasks`
          : 'Your home'

  return (
    <div className="flex min-h-svh flex-col bg-neutral-100 dark:bg-neutral-950">
      <header className="sticky top-0 z-40 flex shrink-0 items-center gap-2 border-b border-neutral-200 bg-white/90 px-3 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90">
        <button
          type="button"
          onClick={goBack}
          aria-label="Back"
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-100 dark:text-neutral-400 dark:active:bg-neutral-800 ${showBack ? '' : 'invisible'}`}
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
        </button>
        <h1 className="flex-1 truncate text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{title}</h1>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-5">
        {screen === 'profile' && (
          <ProfileScreen profile={profile} setProfile={setProfile} onContinue={() => setScreen('roomselect')} />
        )}
        {screen === 'roomselect' && (
          <RoomSelectScreen
            defaultSel={defaultSel}
            setDefaultSel={setDefaultSel}
            extraRooms={extraRooms}
            setExtraRooms={setExtraRooms}
            wheelIdx={wheelIdx}
            setWheelIdx={setWheelIdx}
            addExtraRoom={addExtraRoom}
            count={selectedRoomCount}
            onContinue={continueToRoomConfig}
          />
        )}
        {screen === 'config' && room && (
          <ConfigScreen
            room={room}
            cfgStep={cfgStep}
            answerStep={answerStep}
            reopenStep={reopenStep}
            toggleEquip={toggleEquip}
            showEquipAdd={showEquipAdd}
            setShowEquipAdd={setShowEquipAdd}
            customEquipName={customEquipName}
            setCustomEquipName={setCustomEquipName}
            addCustomEquip={addCustomEquip}
            removeCustomEquip={removeCustomEquip}
            confirmEquip={confirmEquipAndBuildTasks}
          />
        )}
        {screen === 'tasks' && room && (
          <TasksScreen
            room={room}
            ti={ti}
            stepFreq={stepFreq}
            setTaskStatus={setTaskStatus}
            decideTask={decideTask}
            ownTaskName={ownTaskName}
            setOwnTaskName={setOwnTaskName}
            ownFreq={ownFreq}
            stepOwnFreq={stepOwnFreq}
            addOwnTask={addOwnTask}
            finishRoom={finishRoom}
          />
        )}
        {screen === 'overview' && (
          <OverviewScreen
            rooms={rooms}
            expanded={expandedOverviewRooms}
            toggleExpanded={toggleOverviewExpanded}
            editRoom={editRoom}
            onAddRemoveRooms={() => setScreen('roomselect')}
            onBuild={buildHome}
            building={building}
          />
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Screen: home profile
// ---------------------------------------------------------------------------

function ToggleRow({
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

function ProfileScreen({
  profile,
  setProfile,
  onContinue,
}: {
  profile: HomeProfile
  setProfile: (p: HomeProfile) => void
  onContinue: () => void
}) {
  return (
    <>
      <h2 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">A few quick things</h2>
      <p className="mb-4 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        These adjust the suggestions we build for you later — pets speed up floor cycles, plants add watering tasks.
      </p>
      <ToggleRow icon={PawPrint} label="Pets" on={profile.pets} onToggle={() => setProfile({ ...profile, pets: !profile.pets })} />
      <ToggleRow icon={SproutIcon} label="Plants" on={profile.plants} onToggle={() => setProfile({ ...profile, plants: !profile.plants })} />
      <ToggleRow
        icon={Laptop}
        label="Work from home"
        on={profile.wfh}
        onToggle={() => setProfile({ ...profile, wfh: !profile.wfh })}
      />
      <button type="button" onClick={onContinue} className={`${CTA} mt-2`}>
        Continue
      </button>
    </>
  )
}

// ---------------------------------------------------------------------------
// Screen: room selection
// ---------------------------------------------------------------------------

function RoomSelectScreen({
  defaultSel,
  setDefaultSel,
  extraRooms,
  setExtraRooms,
  wheelIdx,
  setWheelIdx,
  addExtraRoom,
  count,
  onContinue,
}: {
  defaultSel: Record<RoomType, boolean>
  setDefaultSel: (fn: (prev: Record<RoomType, boolean>) => Record<RoomType, boolean>) => void
  extraRooms: Array<{ type: RoomType; label: string }>
  setExtraRooms: (fn: (prev: Array<{ type: RoomType; label: string }>) => Array<{ type: RoomType; label: string }>) => void
  wheelIdx: number
  setWheelIdx: (i: number) => void
  addExtraRoom: () => void
  count: number
  onContinue: () => void
}) {
  return (
    <>
      <h2 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">Which rooms do you have?</h2>
      <p className="mb-4 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        Toggle what applies — we'll set them up one by one afterwards.
      </p>

      {DEFAULT_ROOM_TYPES.map((type) => (
        <ToggleRow
          key={type}
          icon={roomIcon(type)}
          label={TYPE_META[type]}
          on={defaultSel[type]}
          onToggle={() => setDefaultSel((prev) => ({ ...prev, [type]: !prev[type] }))}
        />
      ))}

      {extraRooms.map((room, i) => {
        const RoomIcon = roomIcon(room.type)
        return (
          <div key={`${room.type}-${i}`} className={`mb-2 flex items-center gap-3 ${CARD} px-3.5 py-3.5`}>
            <RoomIcon className="h-5 w-5 shrink-0 text-neutral-500 dark:text-neutral-400" strokeWidth={1.8} aria-hidden="true" />
            <span className="flex-1 text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{room.label}</span>
            <button
              type="button"
              onClick={() => setExtraRooms((prev) => prev.filter((_, j) => j !== i))}
              aria-label={`Remove ${room.label}`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-black/5 bg-neutral-50 text-neutral-500 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-400"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )
      })}

      <div className={`mt-2 ${CARD} p-3`}>
        <div className="mb-2 text-[11px] font-semibold text-neutral-400 dark:text-neutral-500">Add another room</div>
        <div className="flex items-center gap-2">
          <RoomTypeWheel index={wheelIdx} onChange={setWheelIdx} />
          <button
            type="button"
            onClick={addExtraRoom}
            aria-label="Add room"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-black/5 bg-white text-neutral-900 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <button type="button" onClick={onContinue} disabled={count === 0} className={`${CTA} mt-4`}>
        Continue with {count} room{count === 1 ? '' : 's'}
      </button>
    </>
  )
}

// ---------------------------------------------------------------------------
// Screen: per-room config accordion
// ---------------------------------------------------------------------------

function AnsweredRow({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <button type="button" onClick={onEdit} className={`mb-1.5 flex w-full items-center gap-2.5 ${CARD} px-3 py-2.5 text-left`}>
      <span className="w-16 shrink-0 text-[11px] font-semibold text-neutral-400 dark:text-neutral-500">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">{value}</span>
      <span className="shrink-0 text-[11px] text-neutral-400 dark:text-neutral-500">edit</span>
    </button>
  )
}

function compactValue(room: DraftRoom, step: ConfigStep): string {
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

const STEP_LABEL: Record<ConfigStep, string> = { size: 'Size', windows: 'Windows', floor: 'Floor', equipment: 'Inside' }

function ConfigScreen({
  room,
  cfgStep,
  answerStep,
  reopenStep,
  toggleEquip,
  showEquipAdd,
  setShowEquipAdd,
  customEquipName,
  setCustomEquipName,
  addCustomEquip,
  removeCustomEquip,
  confirmEquip,
}: {
  room: DraftRoom
  cfgStep: number
  answerStep: (step: 'size' | 'windows' | 'floor', value: SizeClass | WindowCount | NonNullable<FloorType>) => void
  reopenStep: (step: ConfigStep) => void
  toggleEquip: (key: string) => void
  showEquipAdd: boolean
  setShowEquipAdd: (v: boolean) => void
  customEquipName: string
  setCustomEquipName: (v: string) => void
  addCustomEquip: () => void
  removeCustomEquip: (key: string) => void
  confirmEquip: () => void
}) {
  const steps = cfgSteps(room.type)
  const compactSteps = steps.slice(0, cfgStep)
  const cur = steps[cfgStep]
  const lib = LIB[room.type]

  return (
    <>
      {compactSteps.map((step) => (
        <AnsweredRow key={step} label={STEP_LABEL[step]} value={compactValue(room, step)} onEdit={() => reopenStep(step)} />
      ))}

      <div className={`${CARD} mt-2.5 p-4`}>
        {cur === 'size' && (
          <>
            <h3 className="mb-3 text-[16px] font-bold text-neutral-900 dark:text-neutral-100">How big is {room.name}?</h3>
            <div className="flex flex-wrap gap-1.5">
              {SIZES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => answerStep('size', s.key)}
                  className="rounded-lg border border-black/5 bg-neutral-50 px-3.5 py-2.5 text-left text-[13.5px] font-semibold text-neutral-900 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-100"
                >
                  {s.label}
                  <span className="block text-[10.5px] font-normal text-neutral-400 dark:text-neutral-500">{s.range}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {cur === 'windows' && (
          <>
            <h3 className="mb-3 text-[16px] font-bold text-neutral-900 dark:text-neutral-100">Windows?</h3>
            <div className="flex flex-wrap gap-1.5">
              {WINDOWS.map((w) => (
                <button
                  key={w.count}
                  type="button"
                  onClick={() => answerStep('windows', w.count)}
                  className="rounded-lg border border-black/5 bg-neutral-50 px-3.5 py-2.5 text-[13.5px] font-semibold text-neutral-900 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-100"
                >
                  {w.label}
                </button>
              ))}
            </div>
          </>
        )}

        {cur === 'floor' && (
          <>
            <h3 className="mb-3 text-[16px] font-bold text-neutral-900 dark:text-neutral-100">What's on the floor?</h3>
            <div className="flex flex-wrap gap-1.5">
              {FLOORS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => answerStep('floor', f.key)}
                  className="rounded-lg border border-black/5 bg-neutral-50 px-3.5 py-2.5 text-left text-[13.5px] font-semibold text-neutral-900 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-100"
                >
                  {f.label}
                  <span className="block text-[10.5px] font-normal text-neutral-400 dark:text-neutral-500">{f.description}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {cur === 'equipment' && (
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

            <button type="button" onClick={confirmEquip} className={`${CTA} mt-3`}>
              {room.equipment.length ? 'Continue' : 'Empty — continue'}
            </button>
          </>
        )}
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Screen: task-by-task + own-task
// ---------------------------------------------------------------------------

function DecidedTaskRow({ task }: { task: SuggestedTask }) {
  const StatusIcon = STATUS_ICON[task.status]
  return (
    <div className={`mb-1.5 flex items-center gap-2.5 ${CARD} px-3 py-2`}>
      <StatusIcon className="h-4 w-4 shrink-0" style={{ color: STATUS_COLOR[task.status] }} aria-hidden="true" />
      <div className="min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
        {task.name}
        <span className="ml-1.5 text-[11px] font-normal text-neutral-400 dark:text-neutral-500">
          {fmtFreq(task.frequencyDays)} · ~{task.durationMinutes}m
        </span>
      </div>
      <Check className="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" aria-hidden="true" />
    </div>
  )
}

function TasksScreen({
  room,
  ti,
  stepFreq,
  setTaskStatus,
  decideTask,
  ownTaskName,
  setOwnTaskName,
  ownFreq,
  stepOwnFreq,
  addOwnTask,
  finishRoom,
}: {
  room: DraftRoom
  ti: number
  stepFreq: (dir: 1 | -1) => void
  setTaskStatus: (s: TaskStatus) => void
  decideTask: (added: boolean) => void
  ownTaskName: string
  setOwnTaskName: (v: string) => void
  ownFreq: number
  stepOwnFreq: (dir: 1 | -1) => void
  addOwnTask: () => void
  finishRoom: () => void
}) {
  const task = room.tasks[ti]
  const decidedRows = room.tasks.slice(0, ti).filter((t) => t.added)

  if (!task) {
    return (
      <>
        {decidedRows.map((t, i) => (
          <DecidedTaskRow key={i} task={t} />
        ))}
        <div className={`${CARD} mt-2.5 p-4`}>
          <h3 className="text-[16px] font-bold text-neutral-900 dark:text-neutral-100">Your own task for {room.name}?</h3>
          <p className="mb-2.5 mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">Anything the suggestions missed.</p>
          <input
            value={ownTaskName}
            onChange={(e) => setOwnTaskName(e.target.value)}
            placeholder="Task name…"
            className="w-full rounded-lg border border-black/5 bg-neutral-50 px-3 py-2.5 text-[14.5px] font-medium text-neutral-900 outline-none dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-100"
          />
          <div className="mb-1 mt-3 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            How often?
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-neutral-100 p-1.5 dark:bg-neutral-800">
            <button
              type="button"
              onClick={() => stepOwnFreq(-1)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-black/5 bg-white text-neutral-900 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="flex-1 text-center text-[14.5px] font-bold text-neutral-900 dark:text-neutral-100">
              {fmtFreq(ownFreq)}
            </div>
            <button
              type="button"
              onClick={() => stepOwnFreq(1)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-black/5 bg-white text-neutral-900 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <button type="button" onClick={addOwnTask} className={`${CTA} mt-3`}>
            Add this task
          </button>
        </div>
        <button type="button" onClick={finishRoom} className={`${CTA_GHOST} mt-2.5`}>
          Done with {room.name} →
        </button>
      </>
    )
  }

  return (
    <>
      {decidedRows.map((t, i) => (
        <DecidedTaskRow key={i} task={t} />
      ))}
      <div className={`${CARD} mt-2.5 p-4`}>
        <div className="text-[17px] font-bold text-neutral-900 dark:text-neutral-100">{task.name}</div>
        <div className="mb-3 mt-0.5 text-[12px] text-neutral-400 dark:text-neutral-500">
          takes about {task.durationMinutes} min · {ti + 1} of {room.tasks.length} suggestions
        </div>

        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          How often?
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-neutral-100 p-1.5 dark:bg-neutral-800">
          <button
            type="button"
            onClick={() => stepFreq(-1)}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-black/5 bg-white text-neutral-900 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
          <div className="flex-1 text-center">
            <div className="text-[14.5px] font-bold text-neutral-900 dark:text-neutral-100">{fmtFreq(task.frequencyDays)}</div>
            {task.frequencyDays !== task.suggestedFrequencyDays ? (
              <div className="text-[10.5px] font-semibold" style={{ color: SOSO }}>
                suggested {fmtFreq(task.suggestedFrequencyDays)}
              </div>
            ) : (
              <div className="text-[10.5px] font-medium text-neutral-400 dark:text-neutral-500">suggested</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => stepFreq(1)}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-black/5 bg-white text-neutral-900 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mb-1.5 mt-3 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
          State right now
        </div>
        <div className="flex gap-1.5">
          {(['fresh', 'soon', 'overdue'] as const).map((s) => {
            const StatusIcon = STATUS_ICON[s]
            const selected = task.status === s
            return (
              <button
                key={s}
                type="button"
                onClick={() => setTaskStatus(s)}
                className="flex-1 rounded-lg border px-2 py-2 text-center text-[11.5px] font-semibold"
                style={
                  selected
                    ? { borderColor: STATUS_COLOR[s], backgroundColor: `${STATUS_COLOR[s]}20`, color: STATUS_COLOR[s] }
                    : undefined
                }
                data-selected={selected}
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

        <div className="mt-3.5 flex gap-2">
          <button type="button" onClick={() => decideTask(false)} className={`flex-1 ${CTA_GHOST}`}>
            Skip
          </button>
          <button type="button" onClick={() => decideTask(true)} className={`flex-1 ${CTA}`}>
            Add task
          </button>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Screen: overview
// ---------------------------------------------------------------------------

function OverviewScreen({
  rooms,
  expanded,
  toggleExpanded,
  editRoom,
  onAddRemoveRooms,
  onBuild,
  building,
}: {
  rooms: DraftRoom[]
  expanded: Set<number>
  toggleExpanded: (i: number) => void
  editRoom: (i: number) => void
  onAddRemoveRooms: () => void
  onBuild: () => void
  building: boolean
}) {
  return (
    <>
      <h2 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">Everything correct?</h2>
      <p className="mb-4 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400">
        Tap a room to review — this lives behind the gear button later, so nothing here is final.
      </p>

      {rooms.map((room, i) => {
        const added = room.tasks.filter((t) => t.added)
        const setLine = [
          SIZES.find((s) => s.key === room.sizeClass)?.label,
          WINDOWS.find((w) => w.count === room.windows)?.label,
          !LIB[room.type].noFloor ? FLOORS.find((f) => f.key === room.floor)?.label : null,
        ]
          .filter(Boolean)
          .join(' · ')
        const isExpanded = expanded.has(i)
        const RoomIcon = roomIcon(room.type)

        return (
          <div key={i} className={`mb-2.5 ${CARD} p-3.5`}>
            <button type="button" onClick={() => toggleExpanded(i)} className="flex w-full items-center gap-2.5 text-left">
              <RoomIcon className="h-5 w-5 shrink-0 text-neutral-500 dark:text-neutral-400" strokeWidth={1.8} aria-hidden="true" />
              <span className="flex-1 text-[15px] font-bold text-neutral-900 dark:text-neutral-100">{room.name}</span>
              <span className="shrink-0 text-[12px] text-neutral-400 dark:text-neutral-500">
                {added.length} task{added.length === 1 ? '' : 's'} {isExpanded ? '▴' : '▾'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => editRoom(i)}
              className="mt-1 text-left text-[12px] text-neutral-400 underline decoration-dotted underline-offset-2 dark:text-neutral-500"
            >
              {setLine} · edit
            </button>
            {isExpanded && (
              <div className="mt-2 space-y-1 border-t border-black/5 pt-2 dark:border-white/10">
                {added.map((t, ti) => (
                  <div key={ti} className="flex justify-between text-[12.5px] text-neutral-500 dark:text-neutral-400">
                    <span className="font-medium text-neutral-900 dark:text-neutral-100">{t.name}</span>
                    <span>{fmtFreq(t.frequencyDays)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <button type="button" onClick={onAddRemoveRooms} className={`${CTA_GHOST} mt-2`}>
        + Add or remove rooms
      </button>
      <button type="button" onClick={onBuild} disabled={building} className={`${CTA} mt-2.5`}>
        {building ? 'Building…' : 'Build my home'}
      </button>
    </>
  )
}
