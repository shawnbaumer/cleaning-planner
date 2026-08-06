import { useState } from 'react'
import { ChevronLeft, Plus, X, PawPrint, Sprout as SproutIcon, Laptop } from 'lucide-react'
import { db, type FloorType, type RoomType, type SizeClass, type WindowCount } from './lib/db'
import {
  LIB,
  TYPE_META,
  DEFAULT_ROOM_TYPES,
  WHEEL_ROOM_TYPES,
  FREQ_STEPS,
  fmtFreq,
  buildTasks,
  baselineLastCompletedDate,
  type HomeProfile,
  type SuggestedTask,
  type TaskStatus,
} from './lib/library'
import { roomIcon } from './lib/icons'
import {
  CARD,
  CTA,
  CTA_GHOST,
  ToggleRow,
  FreqStepper,
  DecidedTaskRow,
  TaskDecideCard,
  RoomTypeWheel,
  cfgSteps,
  roomSetLine,
  RoomConfigAccordion,
  type ConfigStep,
} from './components/wizard-shared'

// ---------------------------------------------------------------------------
// Wizard-local draft state — mirrors the approved mockup's `state.rooms`
// shape, but with nullable answer fields so "answered vs. not yet" is
// explicit (see cfgSteps/answerStep below).
// ---------------------------------------------------------------------------

type Screen = 'profile' | 'roomselect' | 'config' | 'tasks' | 'overview'

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

function emptyDraftRoom(type: RoomType, name: string): DraftRoom {
  return { type, name, sizeClass: null, windows: null, floor: null, equipment: [], tasks: [] }
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
  const openStep = steps[cfgStep] ?? null

  return (
    <RoomConfigAccordion
      room={room}
      openStep={openStep}
      compactSteps={compactSteps}
      onAnswer={answerStep}
      onReopen={reopenStep}
      toggleEquip={toggleEquip}
      showEquipAdd={showEquipAdd}
      setShowEquipAdd={setShowEquipAdd}
      customEquipName={customEquipName}
      setCustomEquipName={setCustomEquipName}
      addCustomEquip={addCustomEquip}
      removeCustomEquip={removeCustomEquip}
      equipCtaLabel={room.equipment.length ? 'Continue' : 'Empty — continue'}
      onEquipCta={confirmEquip}
    />
  )
}

// ---------------------------------------------------------------------------
// Screen: task-by-task + own-task
// ---------------------------------------------------------------------------

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
          <DecidedTaskRow key={i} name={t.name} frequencyDays={t.frequencyDays} durationMinutes={t.durationMinutes} status={t.status} />
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
          <FreqStepper value={ownFreq} suggested={null} onDec={() => stepOwnFreq(-1)} onInc={() => stepOwnFreq(1)} />
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
        <DecidedTaskRow key={i} name={t.name} frequencyDays={t.frequencyDays} durationMinutes={t.durationMinutes} status={t.status} />
      ))}
      <TaskDecideCard
        name={task.name}
        durationMinutes={task.durationMinutes}
        indexLabel={`${ti + 1} of ${room.tasks.length} suggestions`}
        frequencyDays={task.frequencyDays}
        suggestedFrequencyDays={task.suggestedFrequencyDays}
        onStepFreq={stepFreq}
        status={task.status}
        onSetStatus={setTaskStatus}
        onSkip={() => decideTask(false)}
        onAdd={() => decideTask(true)}
      />
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
        const setLine = roomSetLine(room)
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
