import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  ChevronLeft,
  Home as HomeIcon,
  PawPrint,
  Sprout as SproutIcon,
  Laptop,
  Plus,
  CircleAlert,
  type LucideIcon,
} from 'lucide-react'
import {
  db,
  deleteTaskCascade,
  deleteTasksCascade,
  deleteRoomCascade,
  exportAllData,
  importAllData,
  isExportPayload,
  type Room,
  type Task,
  type SizeClass,
  type WindowCount,
  type FloorType,
  type ExportPayload,
} from './lib/db'
import {
  LIB,
  TYPE_META,
  WHEEL_ROOM_TYPES,
  FREQ_STEPS,
  fmtFreq,
  buildTasks,
  baselineLastCompletedDate,
  suggestedFrequencyForTask,
  type HomeProfile,
  type SuggestedTask,
  type TaskStatus,
  type DraftRoomConfig,
} from './lib/library'
import { roomIcon } from './lib/icons'
import {
  CARD,
  CTA,
  CTA_GHOST,
  GOOD,
  UGLY,
  FreqStepper,
  StatusChips,
  DecidedTaskRow,
  TaskDecideCard,
  RoomTypeWheel,
  cfgSteps,
  roomSetLine,
  RoomConfigAccordion,
  type ConfigStep,
  type ConfigRoomDraft,
} from './components/wizard-shared'

const FLABEL = 'mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500'
const SUB = 'mb-2.5 text-[13px] leading-relaxed text-neutral-500 dark:text-neutral-400'

function roomToConfig(room: Room): DraftRoomConfig {
  return { type: room.type, sizeClass: room.sizeClass, windows: room.windows, floor: room.floor, equipment: room.equipment }
}

// ---------------------------------------------------------------------------
// Manage-local state shapes
// ---------------------------------------------------------------------------

type ManageScreen = 'manage' | 'rooms' | 'config' | 'redecide'

interface CfgState {
  mode: 'edit' | 'new'
  /** Set in edit mode (the room being reconfigured); null in new mode (not persisted yet). */
  roomId: number | null
  /** Snapshot of the config on entry, for edit mode's news/removals diff. Null in new mode. */
  cfg0: DraftRoomConfig | null
  /** Working copy — mutated locally, only written to Dexie when Done/Continue commits it. */
  draft: ConfigRoomDraft
  /** Which question is currently open; null = none open (edit mode's resting state). */
  step: ConfigStep | null
  showEquipAdd: boolean
  customEquipName: string
}

interface RdState {
  mode: 'edit' | 'new'
  /** Set in edit mode; null in new mode until the commit transaction assigns one. */
  roomId: number | null
  /** Set in new mode — the not-yet-persisted room this re-decide session belongs to. */
  draftRoom: ConfigRoomDraft | null
  list: SuggestedTask[]
  i: number
  /** Existing task ids offered for keep-or-remove after the list is exhausted (edit mode only). */
  removals: number[]
}

interface AddDraft extends SuggestedTask {
  own: boolean
}

// ---------------------------------------------------------------------------

export default function Manage({ onBack }: { onBack: () => void }) {
  const homes = useLiveQuery(() => db.homes.toArray())
  const rooms = useLiveQuery(() => db.rooms.toArray())
  const tasks = useLiveQuery(() => db.tasks.toArray())

  const [screen, setScreen] = useState<ManageScreen>('manage')
  const [hhOpen, setHhOpen] = useState(false)
  const [openRooms, setOpenRooms] = useState<Set<number>>(new Set())

  const [editingTaskId, setEditingTaskId] = useState<number | null>(null)
  const [confirmDeleteTaskId, setConfirmDeleteTaskId] = useState<number | null>(null)

  const [addingRoomId, setAddingRoomId] = useState<number | null>(null)
  const [addDraft, setAddDraft] = useState<AddDraft | null>(null)
  const [ownName, setOwnName] = useState('')
  const [ownFreq, setOwnFreq] = useState(7)

  const [cfg, setCfg] = useState<CfgState | null>(null)

  const [wheelIdx, setWheelIdx] = useState(0)
  const [confirmDeleteRoomId, setConfirmDeleteRoomId] = useState<number | null>(null)

  const [rd, setRd] = useState<RdState | null>(null)
  const finishingRef = useRef(false)

  const [importError, setImportError] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<ExportPayload | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Once the current suggestion list is exhausted and there's nothing left to
  // prompt for removal, finish automatically — mirrors the mockup's render()
  // falling through to finishRedecide() when there's nothing left to show.
  // Declared before the loading-state early return below (rules of hooks);
  // `rd` can only be non-null once data has loaded, so this is a no-op until
  // then regardless.
  useEffect(() => {
    if (screen === 'redecide' && rd && rd.i >= rd.list.length && rd.removals.length === 0) {
      void finishRedecide()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, rd])

  if (!homes || !rooms || !tasks) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-neutral-100 dark:bg-neutral-950">
        <p className="text-neutral-400 dark:text-neutral-500">Loading…</p>
      </div>
    )
  }

  const homeRow = homes[0]
  if (!homeRow) return null // App only renders Manage once a home exists.

  const profile: HomeProfile = { pets: homeRow.pets, plants: homeRow.plants, wfh: homeRow.wfh }
  const roomsById = new Map<number, Room>(rooms.map((r) => [r.id, r]))
  const tasksById = new Map<number, Task>(tasks.map((t) => [t.id, t]))
  const tasksByRoom = (roomId: number) => tasks.filter((t) => t.roomId === roomId)

  // -- navigation -------------------------------------------------------

  function goBack() {
    if (screen === 'manage') {
      onBack()
      return
    }
    if (screen === 'rooms') {
      setConfirmDeleteRoomId(null)
      setScreen('manage')
      return
    }
    if (screen === 'config') {
      // Edit mode hasn't written anything yet at this point — it lives
      // entirely in the local `cfg` draft until Done commits it — so
      // backing out of it always just discards the draft outright.
      if (cfg?.mode === 'new') {
        // New-room mode mirrors the wizard: step back one question at a
        // time, and only abandon the draft (never persisted) once backing
        // out of the very first question.
        const steps = cfgSteps(cfg.draft.type)
        const idx = cfg.step ? steps.indexOf(cfg.step) : 0
        if (idx > 0) {
          setCfg((prev) => prev && { ...prev, step: steps[idx - 1] })
          return
        }
        setCfg(null)
        setScreen('rooms')
        return
      }
      setCfg(null)
      setScreen('manage')
      return
    }
    if (screen === 'redecide') {
      void finishRedecide()
    }
  }

  // -- household ----------------------------------------------------------

  async function toggleProfileField(key: 'pets' | 'plants' | 'wfh') {
    await db.homes.update(homeRow.id, { [key]: !homeRow[key] })
  }

  // -- rooms (expand/collapse on the manage screen) ------------------------

  function toggleRoomOpen(roomId: number) {
    setOpenRooms((prev) => {
      const next = new Set(prev)
      if (next.has(roomId)) next.delete(roomId)
      else next.add(roomId)
      return next
    })
    setEditingTaskId(null)
    setConfirmDeleteTaskId(null)
    setAddingRoomId(null)
    setAddDraft(null)
  }

  // -- task row: edit / rename / re-frequency / delete ----------------------

  function openTaskEditor(taskId: number) {
    setEditingTaskId(taskId)
    setConfirmDeleteTaskId(null)
    setAddingRoomId(null)
    setAddDraft(null)
  }

  function closeTaskEditor() {
    setEditingTaskId(null)
    setConfirmDeleteTaskId(null)
  }

  async function renameTask(taskId: number, name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    await db.tasks.update(taskId, { name: trimmed })
  }

  async function stepTaskFreq(taskId: number, dir: 1 | -1) {
    const task = tasksById.get(taskId)
    if (!task) return
    let fi = FREQ_STEPS.indexOf(task.frequencyDays)
    if (fi < 0) fi = FREQ_STEPS.findIndex((s) => s >= task.frequencyDays)
    fi = Math.min(FREQ_STEPS.length - 1, Math.max(0, fi + dir))
    await db.tasks.update(taskId, { frequencyDays: FREQ_STEPS[fi] })
  }

  async function confirmDeleteTask(taskId: number) {
    await deleteTaskCascade(taskId)
    setConfirmDeleteTaskId(null)
    setEditingTaskId(null)
  }

  // -- add-task panel -------------------------------------------------------

  function openAddPanel(roomId: number) {
    setAddingRoomId(roomId)
    setAddDraft(null)
    setOwnName('')
    setOwnFreq(7)
    setEditingTaskId(null)
    setConfirmDeleteTaskId(null)
  }

  function closeAddPanel() {
    setAddingRoomId(null)
    setAddDraft(null)
  }

  function pickSuggestion(s: SuggestedTask) {
    setAddDraft({ ...s, status: 'soon', own: false })
  }

  function ownFreqStep(dir: 1 | -1) {
    let fi = FREQ_STEPS.indexOf(ownFreq)
    fi = Math.min(FREQ_STEPS.length - 1, Math.max(0, fi + dir))
    setOwnFreq(FREQ_STEPS[fi])
  }

  function ownNext() {
    const name = ownName.trim()
    if (!name) return
    setAddDraft({
      name,
      frequencyDays: ownFreq,
      suggestedFrequencyDays: ownFreq,
      durationMinutes: 10,
      icon: 'Sparkles',
      status: 'soon',
      added: null,
      own: true,
    })
  }

  function draftFreqStep(dir: 1 | -1) {
    setAddDraft((prev) => {
      if (!prev) return prev
      let fi = FREQ_STEPS.indexOf(prev.frequencyDays)
      if (fi < 0) fi = FREQ_STEPS.findIndex((s) => s >= prev.frequencyDays)
      fi = Math.min(FREQ_STEPS.length - 1, Math.max(0, fi + dir))
      return { ...prev, frequencyDays: FREQ_STEPS[fi] }
    })
  }

  function draftStatus(s: TaskStatus) {
    setAddDraft((prev) => prev && { ...prev, status: s })
  }

  async function commitDraft(roomId: number) {
    if (!addDraft) return
    const now = Date.now()
    await db.tasks.add({
      roomId,
      name: addDraft.name,
      frequencyDays: addDraft.frequencyDays,
      estimatedDurationMinutes: addDraft.durationMinutes,
      lastCompletedDate: baselineLastCompletedDate(addDraft.frequencyDays, addDraft.status, now),
      icon: addDraft.own ? undefined : addDraft.icon,
    } as Omit<Task, 'id'> as Task)
    setAddingRoomId(null)
    setAddDraft(null)
    setOwnName('')
    setOwnFreq(7)
  }

  // -- add / remove rooms screen --------------------------------------------

  async function requestDeleteRoom(roomId: number) {
    setConfirmDeleteRoomId(roomId)
  }

  async function confirmDeleteRoom(roomId: number) {
    await deleteRoomCascade(roomId)
    setConfirmDeleteRoomId(null)
    setOpenRooms((prev) => {
      const next = new Set(prev)
      next.delete(roomId)
      return next
    })
  }

  function startAddRoom() {
    const type = WHEEL_ROOM_TYPES[wheelIdx]
    const existingCount = roomsById.size ? Array.from(roomsById.values()).filter((r) => r.type === type).length : 0
    const name = existingCount ? `${TYPE_META[type]} ${existingCount + 1}` : TYPE_META[type]
    const draft: ConfigRoomDraft = { type, name, sizeClass: null, windows: null, floor: null, equipment: [] }
    setCfg({ mode: 'new', roomId: null, cfg0: null, draft, step: cfgSteps(type)[0], showEquipAdd: false, customEquipName: '' })
    setConfirmDeleteRoomId(null)
    setScreen('config')
  }

  // -- config accordion (shared shape for edit + new) -----------------------

  function openRoomConfig(room: Room) {
    const cfg0 = roomToConfig(room)
    const draft: ConfigRoomDraft = { type: room.type, name: room.name, sizeClass: room.sizeClass, windows: room.windows, floor: room.floor, equipment: [...room.equipment] }
    setCfg({ mode: 'edit', roomId: room.id, cfg0, draft, step: null, showEquipAdd: false, customEquipName: '' })
    setScreen('config')
  }

  function answerCfgStep(step: 'size' | 'windows' | 'floor', value: SizeClass | WindowCount | NonNullable<FloorType>) {
    setCfg((prev) => {
      if (!prev) return prev
      const draft: ConfigRoomDraft = {
        ...prev.draft,
        ...(step === 'size' ? { sizeClass: value as SizeClass } : {}),
        ...(step === 'windows' ? { windows: value as WindowCount } : {}),
        ...(step === 'floor' ? { floor: value as FloorType } : {}),
      }
      if (prev.mode === 'new') {
        const steps = cfgSteps(draft.type)
        let next: ConfigStep = steps[steps.length - 1]
        for (const s of steps) {
          if (s === 'size' && draft.sizeClass === null) {
            next = s
            break
          }
          if (s === 'windows' && draft.windows === null) {
            next = s
            break
          }
          if (s === 'floor' && draft.floor === null) {
            next = s
            break
          }
        }
        return { ...prev, draft, step: next }
      }
      return { ...prev, draft, step: null }
    })
  }

  function reopenCfgStep(step: ConfigStep) {
    setCfg((prev) => prev && { ...prev, step })
  }

  function toggleCfgEquip(key: string) {
    setCfg((prev) => {
      if (!prev) return prev
      const equipment = prev.draft.equipment.includes(key)
        ? prev.draft.equipment.filter((k) => k !== key)
        : [...prev.draft.equipment, key]
      return { ...prev, draft: { ...prev.draft, equipment } }
    })
  }

  function addCfgCustomEquip() {
    setCfg((prev) => {
      if (!prev) return prev
      const name = prev.customEquipName.trim()
      if (!name) return prev
      return { ...prev, draft: { ...prev.draft, equipment: [...prev.draft.equipment, `custom:${name}`] }, customEquipName: '', showEquipAdd: false }
    })
  }

  function removeCfgCustomEquip(key: string) {
    setCfg((prev) => prev && { ...prev, draft: { ...prev.draft, equipment: prev.draft.equipment.filter((k) => k !== key) } })
  }

  function confirmNewRoomEquip() {
    setCfg((prevCfg) => {
      if (!prevCfg || prevCfg.mode !== 'new') return prevCfg
      const draftConfig: DraftRoomConfig = {
        type: prevCfg.draft.type,
        sizeClass: prevCfg.draft.sizeClass ?? 'M',
        windows: prevCfg.draft.windows ?? 0,
        floor: prevCfg.draft.floor,
        equipment: prevCfg.draft.equipment,
      }
      const list = buildTasks(draftConfig, profile)
      const draftRoom: ConfigRoomDraft = { ...prevCfg.draft, sizeClass: draftConfig.sizeClass, windows: draftConfig.windows }
      setRd({ mode: 'new', roomId: null, draftRoom, list, i: 0, removals: [] })
      setScreen('redecide')
      return null
    })
  }

  function collapseEditEquip() {
    setCfg((prev) => prev && { ...prev, step: null })
  }

  async function applyConfigEdit() {
    if (!cfg || cfg.mode !== 'edit' || cfg.roomId === null || !cfg.cfg0) return
    const roomId = cfg.roomId
    const draftConfig: DraftRoomConfig = {
      type: cfg.draft.type,
      sizeClass: cfg.draft.sizeClass ?? 'M',
      windows: cfg.draft.windows ?? 0,
      floor: cfg.draft.floor,
      equipment: cfg.draft.equipment,
    }
    const lib0Names = buildTasks(cfg.cfg0, profile).map((t) => t.name)
    const lib1 = buildTasks(draftConfig, profile)
    const lib1Names = lib1.map((t) => t.name)
    const roomTasks = tasksByRoom(roomId)
    const news = lib1.filter((t) => !lib0Names.includes(t.name) && !roomTasks.some((rt) => rt.name === t.name))
    const removals = roomTasks.filter((t) => lib0Names.includes(t.name) && !lib1Names.includes(t.name)).map((t) => t.id)

    await db.rooms.update(roomId, {
      sizeClass: draftConfig.sizeClass,
      windows: draftConfig.windows,
      floor: LIB[draftConfig.type].noFloor ? null : draftConfig.floor,
      equipment: draftConfig.equipment,
    })

    setCfg(null)
    if (news.length || removals.length) {
      setRd({ mode: 'edit', roomId, draftRoom: null, list: news, i: 0, removals })
      setScreen('redecide')
    } else {
      setScreen('manage')
    }
  }

  // -- re-decide screen -------------------------------------------------

  function rdStepFreq(dir: 1 | -1) {
    setRd((prev) => {
      if (!prev) return prev
      const t = prev.list[prev.i]
      if (!t) return prev
      let fi = FREQ_STEPS.indexOf(t.frequencyDays)
      if (fi < 0) fi = FREQ_STEPS.findIndex((s) => s >= t.frequencyDays)
      fi = Math.min(FREQ_STEPS.length - 1, Math.max(0, fi + dir))
      const list = prev.list.map((x, i) => (i === prev.i ? { ...x, frequencyDays: FREQ_STEPS[fi] } : x))
      return { ...prev, list }
    })
  }

  function rdSetStatus(s: TaskStatus) {
    setRd((prev) => prev && { ...prev, list: prev.list.map((x, i) => (i === prev.i ? { ...x, status: s } : x)) })
  }

  function rdDecide(added: boolean) {
    setRd((prev) => {
      if (!prev) return prev
      const list = prev.list.map((x, i) => (i === prev.i ? { ...x, added } : x))
      return { ...prev, list, i: prev.i + 1 }
    })
  }

  function rdKeep() {
    setRd((prev) => prev && { ...prev, removals: [] })
  }

  async function rdRemove() {
    if (!rd) return
    await deleteTasksCascade(rd.removals)
    setRd((prev) => prev && { ...prev, removals: [] })
  }

  async function finishRedecide() {
    if (!rd) {
      setScreen('manage')
      return
    }
    if (finishingRef.current) return
    finishingRef.current = true
    try {
      const addedTasks = rd.list.filter((t) => t.added)
      const now = Date.now()

      if (rd.mode === 'new' && rd.draftRoom) {
        const draftRoom = rd.draftRoom
        const newRoomId = await db.transaction('rw', db.rooms, db.tasks, async () => {
          const roomId = await db.rooms.add({
            homeId: homeRow.id,
            name: draftRoom.name,
            type: draftRoom.type,
            sizeClass: draftRoom.sizeClass ?? 'M',
            windows: draftRoom.windows ?? 0,
            floor: LIB[draftRoom.type].noFloor ? null : draftRoom.floor,
            equipment: draftRoom.equipment,
          })
          for (const t of addedTasks) {
            await db.tasks.add({
              roomId,
              name: t.name,
              frequencyDays: t.frequencyDays,
              estimatedDurationMinutes: t.durationMinutes,
              lastCompletedDate: baselineLastCompletedDate(t.frequencyDays, t.status, now),
              icon: t.icon,
            })
          }
          return roomId
        })
        setOpenRooms((prev) => new Set(prev).add(newRoomId))
      } else if (rd.mode === 'edit' && rd.roomId !== null) {
        const roomId = rd.roomId
        await db.transaction('rw', db.tasks, async () => {
          for (const t of addedTasks) {
            await db.tasks.add({
              roomId,
              name: t.name,
              frequencyDays: t.frequencyDays,
              estimatedDurationMinutes: t.durationMinutes,
              lastCompletedDate: baselineLastCompletedDate(t.frequencyDays, t.status, now),
              icon: t.icon,
            })
          }
        })
        setOpenRooms((prev) => new Set(prev).add(roomId))
      }

      setRd(null)
      setScreen('manage')
    } finally {
      finishingRef.current = false
    }
  }

  // -- data export / import ----------------------------------------------

  async function handleExport() {
    const payload = await exportAllData()
    const json = JSON.stringify(payload, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const date = new Date().toISOString().slice(0, 10)
    const a = document.createElement('a')
    a.href = url
    a.download = `cleaning-planner-${date}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function openImportPicker() {
    setImportError(null)
    fileInputRef.current?.click()
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setImportError(null)
    let data: unknown
    try {
      data = JSON.parse(await file.text())
    } catch {
      setImportError("Could not read that file — make sure it's a valid backup JSON.")
      return
    }
    if (!isExportPayload(data)) {
      setImportError("This file doesn't look like a Cleaning Planner backup.")
      return
    }
    if (data.version > db.verno) {
      setImportError(
        `This backup is from a newer app version (schema v${data.version}) than this one supports (v${db.verno}). Update the app before importing.`,
      )
      return
    }
    setPendingImport(data)
  }

  async function confirmImport() {
    if (!pendingImport) return
    await importAllData(pendingImport)
    window.location.reload()
  }

  // -- header -----------------------------------------------------------

  const title =
    screen === 'manage'
      ? 'Your home'
      : screen === 'rooms'
        ? 'Rooms'
        : screen === 'config' && cfg
          ? `${cfg.draft.name} · ${cfg.mode === 'new' ? 'new room' : 'setup'}`
          : screen === 'redecide' && rd
            ? `${(rd.mode === 'new' ? rd.draftRoom?.name : roomsById.get(rd.roomId ?? -1)?.name) ?? ''} · new tasks`
            : 'Your home'

  return (
    <div className="flex min-h-svh flex-col bg-neutral-100 dark:bg-neutral-950">
      <header className="sticky top-0 z-40 flex shrink-0 items-center gap-2 border-b border-neutral-200 bg-white/90 px-3 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/90">
        <button
          type="button"
          onClick={goBack}
          aria-label="Back"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-500 active:bg-neutral-100 dark:text-neutral-400 dark:active:bg-neutral-800"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
        </button>
        <h1 className="flex-1 truncate text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">{title}</h1>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-5">
        {screen === 'manage' && (
          <>
            <ManageHomeScreen
              profile={profile}
              hhOpen={hhOpen}
              onToggleHh={() => setHhOpen(!hhOpen)}
              onToggleProfileField={toggleProfileField}
              rooms={rooms}
              profileConfig={profile}
              tasksByRoom={tasksByRoom}
              openRooms={openRooms}
              onToggleRoom={toggleRoomOpen}
              onOpenConfig={openRoomConfig}
              editingTaskId={editingTaskId}
              confirmDeleteTaskId={confirmDeleteTaskId}
              onOpenEditor={openTaskEditor}
              onCloseEditor={closeTaskEditor}
              onRename={renameTask}
              onFreqStep={stepTaskFreq}
              onRequestDelete={setConfirmDeleteTaskId}
              onCancelDelete={() => setConfirmDeleteTaskId(null)}
              onConfirmDelete={confirmDeleteTask}
              addingRoomId={addingRoomId}
              addDraft={addDraft}
              ownName={ownName}
              ownFreq={ownFreq}
              onOpenAdd={openAddPanel}
              onCloseAdd={closeAddPanel}
              onSetOwnName={setOwnName}
              onOwnFreqStep={ownFreqStep}
              onOwnNext={ownNext}
              onPickSuggestion={pickSuggestion}
              onDraftFreqStep={draftFreqStep}
              onDraftStatus={draftStatus}
              onDraftBack={() => setAddDraft(null)}
              onCommitDraft={commitDraft}
              onGoRooms={() => {
                setConfirmDeleteRoomId(null)
                setScreen('rooms')
              }}
            />
            <DataSection
              importError={importError}
              pendingImport={pendingImport}
              fileInputRef={fileInputRef}
              onExport={handleExport}
              onImportClick={openImportPicker}
              onImportFile={handleImportFile}
              onCancelImport={() => setPendingImport(null)}
              onConfirmImport={confirmImport}
            />
          </>
        )}

        {screen === 'rooms' && (
          <RoomsScreen
            rooms={rooms}
            tasksByRoom={tasksByRoom}
            confirmDeleteRoomId={confirmDeleteRoomId}
            onRequestDelete={requestDeleteRoom}
            onCancelDelete={() => setConfirmDeleteRoomId(null)}
            onConfirmDelete={confirmDeleteRoom}
            wheelIdx={wheelIdx}
            setWheelIdx={setWheelIdx}
            onAddRoom={startAddRoom}
            onDone={() => setScreen('manage')}
          />
        )}

        {screen === 'config' && cfg && (
          <ManageConfigScreen
            cfg={cfg}
            onAnswer={answerCfgStep}
            onReopen={reopenCfgStep}
            onToggleEquip={toggleCfgEquip}
            onSetShowEquipAdd={(v) => setCfg((prev) => prev && { ...prev, showEquipAdd: v })}
            onSetCustomEquipName={(v) => setCfg((prev) => prev && { ...prev, customEquipName: v })}
            onAddCustomEquip={addCfgCustomEquip}
            onRemoveCustomEquip={removeCfgCustomEquip}
            onEquipCta={cfg.mode === 'new' ? confirmNewRoomEquip : collapseEditEquip}
            onApply={applyConfigEdit}
          />
        )}

        {screen === 'redecide' && rd && (
          <RedecideScreen
            rd={rd}
            roomName={(rd.mode === 'new' ? rd.draftRoom?.name : roomsById.get(rd.roomId ?? -1)?.name) ?? ''}
            onStepFreq={rdStepFreq}
            onSetStatus={rdSetStatus}
            onSkip={() => rdDecide(false)}
            onAdd={() => rdDecide(true)}
            tasksById={tasksById}
            onKeep={rdKeep}
            onRemove={rdRemove}
          />
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Screen: manage (household + room cards)
// ---------------------------------------------------------------------------

function ProfileSubrow({ icon: Icon, label, on, onToggle }: { icon: LucideIcon; label: string; on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1.5 text-left">
      <Icon className="h-[18px] w-[18px] shrink-0 text-neutral-500 dark:text-neutral-400" strokeWidth={1.8} aria-hidden="true" />
      <span className="flex-1 text-[14px] font-medium text-neutral-900 dark:text-neutral-100">{label}</span>
      <span
        className={`relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors ${on ? '' : 'bg-neutral-200 dark:bg-neutral-700'}`}
        style={on ? { backgroundColor: GOOD } : undefined}
      >
        <span className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-[21px]' : 'left-[3px]'}`} />
      </span>
    </button>
  )
}

function ConfirmCard({ message, confirmLabel, onCancel, onConfirm }: { message: React.ReactNode; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="my-1.5 rounded-[10px] border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-950/30">
      <p className="mb-2.5 text-[12.5px] leading-relaxed text-neutral-800 dark:text-neutral-100">{message}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-black/5 bg-white py-2 text-[13px] font-semibold text-neutral-600 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-300"
        >
          Cancel
        </button>
        <button type="button" onClick={onConfirm} className="flex-1 rounded-lg bg-red-500 py-2 text-[13px] font-semibold text-white active:bg-red-600">
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}

function TaskRow({
  task,
  room,
  profile,
  isEditing,
  isConfirmingDelete,
  onOpen,
  onRename,
  onFreqStep,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onDone,
}: {
  task: Task
  room: Room
  profile: HomeProfile
  isEditing: boolean
  isConfirmingDelete: boolean
  onOpen: () => void
  onRename: (value: string) => void
  onFreqStep: (dir: 1 | -1) => void
  onRequestDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  onDone: () => void
}) {
  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 rounded-lg px-0.5 py-2 text-left active:bg-neutral-50 dark:active:bg-neutral-800/60"
      >
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-neutral-900 dark:text-neutral-100">
          {task.name}
          <span className="ml-1.5 text-[11.5px] font-normal text-neutral-400 dark:text-neutral-500">
            {fmtFreq(task.frequencyDays)} · ~{task.estimatedDurationMinutes}m
          </span>
        </span>
        <span className="shrink-0 text-[11.5px] text-neutral-400 dark:text-neutral-500">edit</span>
      </button>
    )
  }

  if (isConfirmingDelete) {
    return (
      <ConfirmCard
        message={
          <>
            Delete <b>{task.name}</b>? Its completion history goes with it.
          </>
        }
        confirmLabel="Delete task"
        onCancel={onCancelDelete}
        onConfirm={onConfirmDelete}
      />
    )
  }

  const suggested = suggestedFrequencyForTask(task.name, roomToConfig(room), profile)

  return (
    <div className="my-1.5 rounded-[11px] border border-black/5 bg-neutral-50 p-3 dark:border-white/10 dark:bg-neutral-800/60">
      <div className={`${FLABEL} mt-0`}>Name</div>
      <input
        key={task.id}
        defaultValue={task.name}
        onBlur={(e) => onRename(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        className="w-full rounded-lg border border-black/5 bg-white px-3 py-2 text-[14px] font-medium text-neutral-900 outline-none dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
      />
      <div className={`${FLABEL} mt-2.5`}>How often?</div>
      <FreqStepper value={task.frequencyDays} suggested={suggested} onDec={() => onFreqStep(-1)} onInc={() => onFreqStep(1)} />
      <p className="mt-2 text-[11.5px] leading-relaxed text-neutral-400 dark:text-neutral-500">
        Takes about <b>~{task.estimatedDurationMinutes} min</b> — this adapts automatically as you log completions, so there's nothing to set.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={onRequestDelete} className="px-1.5 py-2 text-[12.5px] font-semibold text-red-500">
          Delete task
        </button>
        <button
          type="button"
          onClick={onDone}
          className="flex-1 rounded-lg bg-neutral-900 py-2.5 text-[13px] font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Done
        </button>
      </div>
    </div>
  )
}

function AddTaskPanel({
  room,
  profile,
  existingTasks,
  draft,
  ownName,
  ownFreq,
  onPickSuggestion,
  onSetOwnName,
  onOwnFreqStep,
  onOwnNext,
  onDraftFreqStep,
  onDraftStatus,
  onDraftBack,
  onCommit,
  onCancel,
}: {
  room: Room
  profile: HomeProfile
  existingTasks: Task[]
  draft: AddDraft | null
  ownName: string
  ownFreq: number
  onPickSuggestion: (s: SuggestedTask) => void
  onSetOwnName: (v: string) => void
  onOwnFreqStep: (dir: 1 | -1) => void
  onOwnNext: () => void
  onDraftFreqStep: (dir: 1 | -1) => void
  onDraftStatus: (s: TaskStatus) => void
  onDraftBack: () => void
  onCommit: () => void
  onCancel: () => void
}) {
  if (draft) {
    return (
      <div className="my-1.5 rounded-[11px] border border-black/5 bg-neutral-50 p-3 dark:border-white/10 dark:bg-neutral-800/60">
        <div className="text-[14.5px] font-bold text-neutral-900 dark:text-neutral-100">{draft.name}</div>
        <div className="mb-2.5 mt-0.5 text-[12px] text-neutral-400 dark:text-neutral-500">takes about {draft.durationMinutes} min</div>
        <div className={FLABEL}>How often?</div>
        <FreqStepper
          value={draft.frequencyDays}
          suggested={draft.own ? null : draft.suggestedFrequencyDays}
          onDec={() => onDraftFreqStep(-1)}
          onInc={() => onDraftFreqStep(1)}
        />
        <div className={`${FLABEL} mt-3`}>State right now</div>
        <StatusChips status={draft.status} onChange={onDraftStatus} />
        <div className="mt-3.5 flex gap-2">
          <button type="button" onClick={onDraftBack} className={`flex-1 ${CTA_GHOST}`}>
            Back
          </button>
          <button type="button" onClick={onCommit} className={`flex-1 ${CTA}`}>
            Add task
          </button>
        </div>
      </div>
    )
  }

  const suggestions = buildTasks(roomToConfig(room), profile).filter((s) => !existingTasks.some((t) => t.name === s.name))

  return (
    <div className="my-1.5 rounded-[11px] border border-black/5 bg-neutral-50 p-3 dark:border-white/10 dark:bg-neutral-800/60">
      {suggestions.length > 0 ? (
        <>
          <div className={`${FLABEL} mt-0`}>Suggestions you skipped</div>
          {suggestions.map((s) => (
            <button
              key={s.name}
              type="button"
              onClick={() => onPickSuggestion(s)}
              className="mb-1.5 flex w-full items-center gap-2.5 rounded-lg border border-black/5 bg-white px-3 py-2.5 text-left dark:border-white/10 dark:bg-neutral-900"
            >
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
                {s.name}
                <span className="ml-1.5 font-medium text-neutral-400 dark:text-neutral-500">
                  {fmtFreq(s.frequencyDays)} · ~{s.durationMinutes}m
                </span>
              </span>
              <span className="shrink-0 text-neutral-400 dark:text-neutral-500">+</span>
            </button>
          ))}
          <div className="my-2.5 flex items-center gap-2.5 text-[11px] font-semibold text-neutral-400 dark:text-neutral-500">
            <span className="h-px flex-1 bg-black/5 dark:bg-white/10" />
            or your own
            <span className="h-px flex-1 bg-black/5 dark:bg-white/10" />
          </div>
        </>
      ) : (
        <div className={`${FLABEL} mt-0`}>Your own task</div>
      )}
      <input
        value={ownName}
        onChange={(e) => onSetOwnName(e.target.value)}
        placeholder="Task name…"
        className="w-full rounded-lg border border-black/5 bg-white px-3 py-2 text-[13.5px] text-neutral-900 outline-none dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
      />
      <div className={`${FLABEL} mt-2.5`}>How often?</div>
      <FreqStepper value={ownFreq} suggested={null} onDec={() => onOwnFreqStep(-1)} onInc={() => onOwnFreqStep(1)} />
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={onCancel} className="px-1.5 py-2 text-[12.5px] font-semibold text-neutral-400 dark:text-neutral-500">
          Cancel
        </button>
        <button
          type="button"
          onClick={onOwnNext}
          className="flex-1 rounded-lg bg-neutral-900 py-2.5 text-[13px] font-semibold text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Next
        </button>
      </div>
    </div>
  )
}

function RoomCard({
  room,
  tasks,
  profile,
  isOpen,
  onToggle,
  onOpenConfig,
  editingTaskId,
  confirmDeleteTaskId,
  onOpenEditor,
  onCloseEditor,
  onRename,
  onFreqStep,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  isAdding,
  addDraft,
  ownName,
  ownFreq,
  onOpenAdd,
  onCloseAdd,
  onSetOwnName,
  onOwnFreqStep,
  onOwnNext,
  onPickSuggestion,
  onDraftFreqStep,
  onDraftStatus,
  onDraftBack,
  onCommitDraft,
}: {
  room: Room
  tasks: Task[]
  profile: HomeProfile
  isOpen: boolean
  onToggle: () => void
  onOpenConfig: () => void
  editingTaskId: number | null
  confirmDeleteTaskId: number | null
  onOpenEditor: (taskId: number) => void
  onCloseEditor: () => void
  onRename: (taskId: number, value: string) => void
  onFreqStep: (taskId: number, dir: 1 | -1) => void
  onRequestDelete: (taskId: number) => void
  onCancelDelete: () => void
  onConfirmDelete: (taskId: number) => void
  isAdding: boolean
  addDraft: AddDraft | null
  ownName: string
  ownFreq: number
  onOpenAdd: () => void
  onCloseAdd: () => void
  onSetOwnName: (v: string) => void
  onOwnFreqStep: (dir: 1 | -1) => void
  onOwnNext: () => void
  onPickSuggestion: (s: SuggestedTask) => void
  onDraftFreqStep: (dir: 1 | -1) => void
  onDraftStatus: (s: TaskStatus) => void
  onDraftBack: () => void
  onCommitDraft: () => void
}) {
  const RoomIcon = roomIcon(room.type)

  return (
    <div className={`${CARD} mb-2.5 p-3.5`}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2.5 text-left">
        <RoomIcon className="h-5 w-5 shrink-0 text-neutral-500 dark:text-neutral-400" strokeWidth={1.8} aria-hidden="true" />
        <span className="flex-1 text-[15px] font-bold text-neutral-900 dark:text-neutral-100">{room.name}</span>
        <span className="shrink-0 text-[12px] text-neutral-400 dark:text-neutral-500">
          {tasks.length} task{tasks.length === 1 ? '' : 's'} {isOpen ? '▴' : '▾'}
        </span>
      </button>
      <button
        type="button"
        onClick={onOpenConfig}
        className="mt-1 text-left text-[12px] text-neutral-400 underline decoration-dotted underline-offset-2 dark:text-neutral-500"
      >
        {roomSetLine(room)} · edit setup
      </button>

      {isOpen && (
        <div className="mt-2 border-t border-black/5 pt-1.5 dark:border-white/10">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              room={room}
              profile={profile}
              isEditing={editingTaskId === task.id}
              isConfirmingDelete={confirmDeleteTaskId === task.id}
              onOpen={() => onOpenEditor(task.id)}
              onRename={(value) => onRename(task.id, value)}
              onFreqStep={(dir) => onFreqStep(task.id, dir)}
              onRequestDelete={() => onRequestDelete(task.id)}
              onCancelDelete={onCancelDelete}
              onConfirmDelete={() => onConfirmDelete(task.id)}
              onDone={onCloseEditor}
            />
          ))}

          {isAdding ? (
            <AddTaskPanel
              room={room}
              profile={profile}
              existingTasks={tasks}
              draft={addDraft}
              ownName={ownName}
              ownFreq={ownFreq}
              onPickSuggestion={onPickSuggestion}
              onSetOwnName={onSetOwnName}
              onOwnFreqStep={onOwnFreqStep}
              onOwnNext={onOwnNext}
              onDraftFreqStep={onDraftFreqStep}
              onDraftStatus={onDraftStatus}
              onDraftBack={onDraftBack}
              onCommit={onCommitDraft}
              onCancel={onCloseAdd}
            />
          ) : (
            <button
              type="button"
              onClick={onOpenAdd}
              className="mt-1.5 w-full rounded-[10px] border border-dashed border-black/15 p-2.5 text-center text-[12.5px] font-semibold text-neutral-500 dark:border-white/15 dark:text-neutral-400"
            >
              + Add task
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ManageHomeScreen({
  profile,
  hhOpen,
  onToggleHh,
  onToggleProfileField,
  rooms,
  profileConfig,
  tasksByRoom,
  openRooms,
  onToggleRoom,
  onOpenConfig,
  editingTaskId,
  confirmDeleteTaskId,
  onOpenEditor,
  onCloseEditor,
  onRename,
  onFreqStep,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  addingRoomId,
  addDraft,
  ownName,
  ownFreq,
  onOpenAdd,
  onCloseAdd,
  onSetOwnName,
  onOwnFreqStep,
  onOwnNext,
  onPickSuggestion,
  onDraftFreqStep,
  onDraftStatus,
  onDraftBack,
  onCommitDraft,
  onGoRooms,
}: {
  profile: HomeProfile
  hhOpen: boolean
  onToggleHh: () => void
  onToggleProfileField: (key: 'pets' | 'plants' | 'wfh') => void
  rooms: Room[]
  profileConfig: HomeProfile
  tasksByRoom: (roomId: number) => Task[]
  openRooms: Set<number>
  onToggleRoom: (roomId: number) => void
  onOpenConfig: (room: Room) => void
  editingTaskId: number | null
  confirmDeleteTaskId: number | null
  onOpenEditor: (taskId: number) => void
  onCloseEditor: () => void
  onRename: (taskId: number, value: string) => void
  onFreqStep: (taskId: number, dir: 1 | -1) => void
  onRequestDelete: (taskId: number) => void
  onCancelDelete: () => void
  onConfirmDelete: (taskId: number) => void
  addingRoomId: number | null
  addDraft: AddDraft | null
  ownName: string
  ownFreq: number
  onOpenAdd: (roomId: number) => void
  onCloseAdd: () => void
  onSetOwnName: (v: string) => void
  onOwnFreqStep: (dir: 1 | -1) => void
  onOwnNext: () => void
  onPickSuggestion: (s: SuggestedTask) => void
  onDraftFreqStep: (dir: 1 | -1) => void
  onDraftStatus: (s: TaskStatus) => void
  onDraftBack: () => void
  onCommitDraft: (roomId: number) => void
  onGoRooms: () => void
}) {
  const hhSummary = [profile.pets && 'Pets', profile.plants && 'Plants', profile.wfh && 'Works from home'].filter(Boolean).join(', ') || 'Nothing set'

  return (
    <>
      <p className={SUB}>Everything here saves instantly — no confirm, just leave when you're done.</p>

      <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Household</div>
      <div className={`${CARD} mb-4 p-3.5`}>
        <button type="button" onClick={onToggleHh} className="flex w-full items-center gap-2.5 text-left">
          <HomeIcon className="h-5 w-5 shrink-0 text-neutral-500 dark:text-neutral-400" strokeWidth={1.8} aria-hidden="true" />
          <span className="flex-1 text-[15px] font-bold text-neutral-900 dark:text-neutral-100">Household</span>
          <span className="shrink-0 text-[12px] text-neutral-400 dark:text-neutral-500">
            {hhSummary} {hhOpen ? '▴' : '▾'}
          </span>
        </button>
        {hhOpen && (
          <div className="mt-2 space-y-0.5 border-t border-black/5 pt-2 dark:border-white/10">
            <ProfileSubrow icon={PawPrint} label="Pets" on={profile.pets} onToggle={() => onToggleProfileField('pets')} />
            <ProfileSubrow icon={SproutIcon} label="Plants" on={profile.plants} onToggle={() => onToggleProfileField('plants')} />
            <ProfileSubrow icon={Laptop} label="Work from home" on={profile.wfh} onToggle={() => onToggleProfileField('wfh')} />
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-neutral-400 dark:text-neutral-500">
              Only affects <b>future</b> suggestions — your current tasks and frequencies stay exactly as they are.
            </p>
          </div>
        )}
      </div>

      <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Rooms</div>
      {rooms.map((room) => (
        <RoomCard
          key={room.id}
          room={room}
          tasks={tasksByRoom(room.id)}
          profile={profileConfig}
          isOpen={openRooms.has(room.id)}
          onToggle={() => onToggleRoom(room.id)}
          onOpenConfig={() => onOpenConfig(room)}
          editingTaskId={editingTaskId}
          confirmDeleteTaskId={confirmDeleteTaskId}
          onOpenEditor={onOpenEditor}
          onCloseEditor={onCloseEditor}
          onRename={onRename}
          onFreqStep={onFreqStep}
          onRequestDelete={onRequestDelete}
          onCancelDelete={onCancelDelete}
          onConfirmDelete={onConfirmDelete}
          isAdding={addingRoomId === room.id}
          addDraft={addingRoomId === room.id ? addDraft : null}
          ownName={ownName}
          ownFreq={ownFreq}
          onOpenAdd={() => onOpenAdd(room.id)}
          onCloseAdd={onCloseAdd}
          onSetOwnName={onSetOwnName}
          onOwnFreqStep={onOwnFreqStep}
          onOwnNext={onOwnNext}
          onPickSuggestion={onPickSuggestion}
          onDraftFreqStep={onDraftFreqStep}
          onDraftStatus={onDraftStatus}
          onDraftBack={onDraftBack}
          onCommitDraft={() => onCommitDraft(room.id)}
        />
      ))}

      <button type="button" onClick={onGoRooms} className={`${CTA_GHOST} mt-2`}>
        + Add or remove rooms
      </button>
    </>
  )
}

// ---------------------------------------------------------------------------
// Data section (export / import) — bottom of the manage screen
// ---------------------------------------------------------------------------

function DataSection({
  importError,
  pendingImport,
  fileInputRef,
  onExport,
  onImportClick,
  onImportFile,
  onCancelImport,
  onConfirmImport,
}: {
  importError: string | null
  pendingImport: ExportPayload | null
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onExport: () => void
  onImportClick: () => void
  onImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void
  onCancelImport: () => void
  onConfirmImport: () => void
}) {
  return (
    <>
      <div className="mb-2 mt-4 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Data</div>
      {pendingImport ? (
        <ConfirmCard
          message="Replace all current data with this backup? This can't be undone."
          confirmLabel="Replace data"
          onCancel={onCancelImport}
          onConfirm={onConfirmImport}
        />
      ) : (
        <div className={`${CARD} p-3.5`}>
          <p className="mb-2.5 text-[12.5px] leading-relaxed text-neutral-400 dark:text-neutral-500">
            Back up everything to a file on this device, or restore from a backup.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onExport}
              className="flex-1 rounded-lg border border-black/5 bg-white py-2.5 text-[13px] font-semibold text-neutral-900 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
            >
              Export data
            </button>
            <button
              type="button"
              onClick={onImportClick}
              className="flex-1 rounded-lg border border-black/5 bg-white py-2.5 text-[13px] font-semibold text-neutral-900 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
            >
              Import data
            </button>
          </div>
          {importError && <p className="mt-2.5 text-[12px] leading-relaxed text-red-500">{importError}</p>}
          <input ref={fileInputRef} type="file" accept=".json,application/json" onChange={onImportFile} className="hidden" />
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Screen: add / remove rooms
// ---------------------------------------------------------------------------

function RoomsScreen({
  rooms,
  tasksByRoom,
  confirmDeleteRoomId,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  wheelIdx,
  setWheelIdx,
  onAddRoom,
  onDone,
}: {
  rooms: Room[]
  tasksByRoom: (roomId: number) => Task[]
  confirmDeleteRoomId: number | null
  onRequestDelete: (roomId: number) => void
  onCancelDelete: () => void
  onConfirmDelete: (roomId: number) => void
  wheelIdx: number
  setWheelIdx: (i: number) => void
  onAddRoom: () => void
  onDone: () => void
}) {
  return (
    <>
      <h2 className="mb-1 text-xl font-bold text-neutral-900 dark:text-neutral-100">Add or remove rooms</h2>
      <p className={SUB}>Removing a room deletes its tasks and their history. Adding one walks you through its setup, like the wizard did.</p>

      {rooms.map((room) => {
        const n = tasksByRoom(room.id).length
        if (confirmDeleteRoomId === room.id) {
          return (
            <ConfirmCard
              key={room.id}
              message={
                <>
                  Remove <b>{room.name}</b>? Its {n} task{n === 1 ? '' : 's'} and their completion history will be deleted.
                </>
              }
              confirmLabel="Remove room"
              onCancel={onCancelDelete}
              onConfirm={() => onConfirmDelete(room.id)}
            />
          )
        }
        const RoomIcon = roomIcon(room.type)
        return (
          <div key={room.id} className={`mb-2 flex items-center gap-3 ${CARD} px-3.5 py-3.5`}>
            <RoomIcon className="h-5 w-5 shrink-0 text-neutral-500 dark:text-neutral-400" strokeWidth={1.8} aria-hidden="true" />
            <span className="flex-1 text-[15px] font-semibold text-neutral-900 dark:text-neutral-100">
              {room.name}
              <small className="block text-[11.5px] font-normal text-neutral-400 dark:text-neutral-500">
                {n} task{n === 1 ? '' : 's'}
              </small>
            </span>
            <button
              type="button"
              onClick={() => onRequestDelete(room.id)}
              aria-label={`Remove ${room.name}`}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-black/5 bg-neutral-50 text-neutral-500 dark:border-white/10 dark:bg-neutral-800 dark:text-neutral-400"
            >
              ✕
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
            onClick={onAddRoom}
            aria-label="Add room"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-black/5 bg-white text-neutral-900 dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100"
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <button type="button" onClick={onDone} className={`${CTA} mt-4`}>
        Done
      </button>
    </>
  )
}

// ---------------------------------------------------------------------------
// Screen: room config (edit setup / new room)
// ---------------------------------------------------------------------------

function ManageConfigScreen({
  cfg,
  onAnswer,
  onReopen,
  onToggleEquip,
  onSetShowEquipAdd,
  onSetCustomEquipName,
  onAddCustomEquip,
  onRemoveCustomEquip,
  onEquipCta,
  onApply,
}: {
  cfg: CfgState
  onAnswer: (step: 'size' | 'windows' | 'floor', value: SizeClass | WindowCount | NonNullable<FloorType>) => void
  onReopen: (step: ConfigStep) => void
  onToggleEquip: (key: string) => void
  onSetShowEquipAdd: (v: boolean) => void
  onSetCustomEquipName: (v: string) => void
  onAddCustomEquip: () => void
  onRemoveCustomEquip: (key: string) => void
  onEquipCta: () => void
  onApply: () => void
}) {
  const steps = cfgSteps(cfg.draft.type)
  const compactSteps = cfg.mode === 'new' ? steps.slice(0, cfg.step ? steps.indexOf(cfg.step) : steps.length) : steps.filter((s) => s !== cfg.step)

  return (
    <>
      {cfg.mode === 'edit' && (
        <p className={SUB}>
          Tap a line to change it. When you're done, anything your changes unlock gets offered as new tasks — what you already have stays untouched.
        </p>
      )}
      <RoomConfigAccordion
        room={cfg.draft}
        openStep={cfg.step}
        compactSteps={compactSteps}
        onAnswer={onAnswer}
        onReopen={onReopen}
        toggleEquip={onToggleEquip}
        showEquipAdd={cfg.showEquipAdd}
        setShowEquipAdd={onSetShowEquipAdd}
        customEquipName={cfg.customEquipName}
        setCustomEquipName={onSetCustomEquipName}
        addCustomEquip={onAddCustomEquip}
        removeCustomEquip={onRemoveCustomEquip}
        equipCtaLabel={cfg.mode === 'new' ? (cfg.draft.equipment.length ? 'Continue' : 'Empty — continue') : 'Done'}
        onEquipCta={onEquipCta}
      />
      {cfg.mode === 'edit' && (
        <button type="button" onClick={onApply} className={`${CTA} mt-4`}>
          Done
        </button>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Screen: re-decide (new suggestions / removals) — shared by config re-edit
// and add-a-room.
// ---------------------------------------------------------------------------

function RedecideScreen({
  rd,
  roomName,
  onStepFreq,
  onSetStatus,
  onSkip,
  onAdd,
  tasksById,
  onKeep,
  onRemove,
}: {
  rd: RdState
  roomName: string
  onStepFreq: (dir: 1 | -1) => void
  onSetStatus: (s: TaskStatus) => void
  onSkip: () => void
  onAdd: () => void
  tasksById: Map<number, Task>
  onKeep: () => void
  onRemove: () => void
}) {
  const t = rd.list[rd.i]
  const decided = rd.list.slice(0, rd.i).filter((x) => x.added)

  return (
    <>
      {rd.mode === 'edit' && (
        <p className={SUB}>
          Your setup change unlocked {rd.list.length === 1 ? 'this' : 'these'} — decide {rd.list.length === 1 ? 'it' : 'each one'}. Nothing else changes.
        </p>
      )}

      {decided.map((x, i) => (
        <DecidedTaskRow key={i} name={x.name} frequencyDays={x.frequencyDays} durationMinutes={x.durationMinutes} status={x.status} />
      ))}

      {t && (
        <TaskDecideCard
          name={t.name}
          durationMinutes={t.durationMinutes}
          indexLabel={`${rd.i + 1} of ${rd.list.length} suggestion${rd.list.length === 1 ? '' : 's'}`}
          frequencyDays={t.frequencyDays}
          suggestedFrequencyDays={t.suggestedFrequencyDays}
          onStepFreq={onStepFreq}
          status={t.status}
          onSetStatus={onSetStatus}
          onSkip={onSkip}
          onAdd={onAdd}
        />
      )}

      {!t && rd.removals.length > 0 && (
        <div className={`${CARD} mt-2.5 p-4`}>
          <h3 className="text-[16px] font-bold text-neutral-900 dark:text-neutral-100">No longer part of {roomName}'s setup</h3>
          <p className={SUB}>{rd.removals.length === 1 ? 'This task' : 'These tasks'} came with something you just removed:</p>
          {rd.removals.map((id) => {
            const task = tasksById.get(id)
            if (!task) return null
            return (
              <div key={id} className={`mb-1.5 flex items-center gap-2.5 ${CARD} px-3 py-2`}>
                <CircleAlert className="h-4 w-4 shrink-0" style={{ color: UGLY }} aria-hidden="true" />
                <span className="flex-1 text-[13px] font-medium text-neutral-900 dark:text-neutral-100">{task.name}</span>
              </div>
            )
          })}
          <div className="mt-3.5 flex gap-2">
            <button type="button" onClick={onKeep} className={`flex-1 ${CTA_GHOST}`}>
              Keep {rd.removals.length === 1 ? 'it' : 'them'}
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="flex-1 rounded-xl border-none bg-red-500 py-3.5 text-center text-[15px] font-semibold text-white active:bg-red-600"
            >
              Remove {rd.removals.length === 1 ? 'it' : `all ${rd.removals.length}`}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
