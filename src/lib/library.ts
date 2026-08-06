import type { FloorType, RoomType, SizeClass, WindowCount } from './db'

const MS_PER_DAY = 24 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// Suggestion library — researched cleaning-task defaults (Tidywell,
// HousewifeHowTos, NBC/science roundups). Deliberately EXCLUDES tasks that
// announce themselves when undone — no trash, no dishes, no visible-mess
// tidying — since those don't need a reminder. Ported from the approved
// mockup (`SETUP_WIZARD_MOCKUP.html`'s `LIB`/`FLOOR_TASKS`/`buildTasks`).
// ---------------------------------------------------------------------------

export interface TaskTemplate {
  name: string
  /** Suggested frequency, in days. */
  frequencyDays: number
  /** Suggested duration, in minutes (before size scaling). */
  durationMinutes: number
  /** Lucide icon name, resolved via iconForTask/ICON_REGISTRY. */
  icon: string
  /** Halves frequency (min 1 day) when the home has pets. */
  pets?: boolean
  /** Scales duration by the room's size factor (see SIZES) when set. */
  sizeScale?: boolean
}

export interface EquipmentOption {
  key: string
  icon: string
  label: string
  tasks: TaskTemplate[]
}

export interface RoomLibraryEntry {
  base: TaskTemplate[]
  equipment: EquipmentOption[]
  /** Kitchen/bathroom: the floor-mop task tightens to a 7-day cycle. */
  floorMop7?: boolean
  /** Adds a "wash curtains / dust blinds" task alongside the window task. */
  windowsCurtains?: boolean
  /** No floor question for this room type (e.g. balcony). */
  noFloor?: boolean
}

export const FLOOR_TASKS: Record<'hard' | 'carpet' | 'mixed', TaskTemplate[]> = {
  hard: [
    { name: 'Vacuum / sweep floor', frequencyDays: 7, durationMinutes: 15, icon: 'Wind', pets: true, sizeScale: true },
    { name: 'Mop floor', frequencyDays: 14, durationMinutes: 15, icon: 'Droplets', sizeScale: true },
  ],
  carpet: [
    { name: 'Vacuum carpet', frequencyDays: 7, durationMinutes: 15, icon: 'Wind', pets: true, sizeScale: true },
  ],
  mixed: [
    { name: 'Vacuum floor & rugs', frequencyDays: 7, durationMinutes: 15, icon: 'Wind', pets: true, sizeScale: true },
    { name: 'Mop hard floor', frequencyDays: 14, durationMinutes: 10, icon: 'Droplets', sizeScale: true },
    { name: 'Shake out rugs', frequencyDays: 30, durationMinutes: 10, icon: 'Footprints' },
  ],
}

export const LIB: Record<RoomType, RoomLibraryEntry> = {
  kitchen: {
    floorMop7: true,
    base: [
      { name: 'Deep-wipe counters & hob', frequencyDays: 2, durationMinutes: 10, icon: 'SprayCan' },
      { name: 'Clean sink & drain', frequencyDays: 7, durationMinutes: 10, icon: 'Droplets' },
      { name: 'Wipe cupboard fronts & handles', frequencyDays: 14, durationMinutes: 10, icon: 'SprayCan' },
    ],
    equipment: [
      { key: 'oven', icon: 'Flame', label: 'Oven', tasks: [{ name: 'Clean oven', frequencyDays: 90, durationMinutes: 45, icon: 'Flame' }] },
      { key: 'fridge', icon: 'Refrigerator', label: 'Fridge', tasks: [{ name: 'Clean fridge & check expiry', frequencyDays: 30, durationMinutes: 20, icon: 'Refrigerator' }] },
      { key: 'dishwasher', icon: 'Utensils', label: 'Dishwasher', tasks: [{ name: 'Clean dishwasher filter', frequencyDays: 30, durationMinutes: 10, icon: 'Utensils' }] },
      { key: 'microwave', icon: 'Microwave', label: 'Microwave', tasks: [{ name: 'Clean microwave inside', frequencyDays: 7, durationMinutes: 5, icon: 'Microwave' }] },
      { key: 'hood', icon: 'Fan', label: 'Extractor hood', tasks: [{ name: 'Degrease hood filter', frequencyDays: 90, durationMinutes: 20, icon: 'Fan' }] },
      { key: 'washer', icon: 'WashingMachine', label: 'Washing machine', tasks: [{ name: 'Washer care cycle & seal', frequencyDays: 30, durationMinutes: 10, icon: 'WashingMachine' }] },
      { key: 'plants', icon: 'Sprout', label: 'Plants', tasks: [{ name: 'Water plants', frequencyDays: 4, durationMinutes: 5, icon: 'Droplets' }] },
    ],
  },
  bathroom: {
    floorMop7: true,
    base: [
      { name: 'Clean toilet', frequencyDays: 7, durationMinutes: 15, icon: 'Toilet' },
      { name: 'Clean sink & mirror', frequencyDays: 7, durationMinutes: 10, icon: 'MirrorRectangular' },
      { name: 'Swap towels', frequencyDays: 4, durationMinutes: 5, icon: 'Shirt' },
      { name: 'Wash bath mat', frequencyDays: 14, durationMinutes: 5, icon: 'WashingMachine' },
      { name: 'Descale taps & showerhead', frequencyDays: 30, durationMinutes: 15, icon: 'ShowerHead' },
    ],
    equipment: [
      {
        key: 'shower',
        icon: 'ShowerHead',
        label: 'Shower',
        tasks: [
          { name: 'Scrub shower & glass', frequencyDays: 7, durationMinutes: 15, icon: 'ShowerHead' },
          { name: 'Wash shower curtain', frequencyDays: 90, durationMinutes: 10, icon: 'Blinds' },
        ],
      },
      { key: 'bathtub', icon: 'Bath', label: 'Bathtub', tasks: [{ name: 'Scrub bathtub', frequencyDays: 7, durationMinutes: 15, icon: 'Bath' }] },
      { key: 'washer', icon: 'WashingMachine', label: 'Washing machine', tasks: [{ name: 'Washer care cycle & seal', frequencyDays: 30, durationMinutes: 10, icon: 'WashingMachine' }] },
      { key: 'dryer', icon: 'Shirt', label: 'Dryer', tasks: [{ name: 'Clear dryer lint & vent', frequencyDays: 90, durationMinutes: 10, icon: 'Shirt' }] },
      { key: 'plants', icon: 'Sprout', label: 'Plants', tasks: [{ name: 'Water plants', frequencyDays: 7, durationMinutes: 5, icon: 'Droplets' }] },
    ],
  },
  bedroom: {
    windowsCurtains: true,
    base: [{ name: 'Dust surfaces', frequencyDays: 7, durationMinutes: 10, icon: 'Feather' }],
    equipment: [
      {
        key: 'bed',
        icon: 'BedDouble',
        label: 'Bed',
        tasks: [
          { name: 'Change bed sheets', frequencyDays: 7, durationMinutes: 15, icon: 'BedDouble' },
          { name: 'Rotate & vacuum mattress', frequencyDays: 120, durationMinutes: 20, icon: 'BedDouble' },
          { name: 'Wash duvet & pillows', frequencyDays: 120, durationMinutes: 15, icon: 'WashingMachine' },
        ],
      },
      { key: 'wardrobe', icon: 'DoorClosed', label: 'Wardrobe', tasks: [{ name: 'Declutter wardrobe', frequencyDays: 180, durationMinutes: 30, icon: 'DoorClosed' }] },
      { key: 'desk', icon: 'LampDesk', label: 'Desk', tasks: [{ name: 'Wipe desk & tech', frequencyDays: 7, durationMinutes: 5, icon: 'LampDesk' }] },
      { key: 'mirror', icon: 'MirrorRectangular', label: 'Mirror', tasks: [{ name: 'Wipe mirror', frequencyDays: 14, durationMinutes: 5, icon: 'MirrorRectangular' }] },
      { key: 'tv', icon: 'Monitor', label: 'TV / electronics', tasks: [{ name: 'Dust electronics & cables', frequencyDays: 14, durationMinutes: 5, icon: 'Monitor' }] },
      { key: 'plants', icon: 'Sprout', label: 'Plants', tasks: [{ name: 'Water plants', frequencyDays: 4, durationMinutes: 5, icon: 'Droplets' }] },
    ],
  },
  'living-room': {
    windowsCurtains: true,
    base: [
      { name: 'Dust surfaces & shelves', frequencyDays: 7, durationMinutes: 15, icon: 'Feather' },
      { name: 'Wipe remotes, switches & handles', frequencyDays: 7, durationMinutes: 5, icon: 'SprayCan' },
    ],
    equipment: [
      {
        key: 'sofa',
        icon: 'Sofa',
        label: 'Sofa',
        tasks: [
          { name: 'Vacuum sofa & under cushions', frequencyDays: 30, durationMinutes: 15, icon: 'Sofa', pets: true },
          { name: 'Wash throws & cushion covers', frequencyDays: 30, durationMinutes: 10, icon: 'WashingMachine' },
        ],
      },
      { key: 'tv', icon: 'Monitor', label: 'TV / electronics', tasks: [{ name: 'Dust TV & electronics', frequencyDays: 14, durationMinutes: 5, icon: 'Monitor' }] },
      { key: 'table', icon: 'Table2', label: 'Dining table', tasks: [{ name: 'Polish table & chairs', frequencyDays: 30, durationMinutes: 10, icon: 'Table2' }] },
      { key: 'shelf', icon: 'Library', label: 'Bookshelf', tasks: [{ name: 'Dust bookshelf & books', frequencyDays: 30, durationMinutes: 10, icon: 'Library' }] },
      { key: 'plants', icon: 'Sprout', label: 'Plants', tasks: [{ name: 'Water plants', frequencyDays: 4, durationMinutes: 5, icon: 'Droplets' }] },
    ],
  },
  hallway: {
    base: [{ name: 'Wipe handles, switches & rails', frequencyDays: 7, durationMinutes: 5, icon: 'SprayCan' }],
    equipment: [
      { key: 'doormat', icon: 'Footprints', label: 'Doormat', tasks: [{ name: 'Shake out doormat', frequencyDays: 7, durationMinutes: 5, icon: 'Footprints' }] },
      { key: 'mirror', icon: 'MirrorRectangular', label: 'Mirror', tasks: [{ name: 'Wipe mirror', frequencyDays: 14, durationMinutes: 5, icon: 'MirrorRectangular' }] },
      { key: 'wardrobe', icon: 'DoorClosed', label: 'Coat closet', tasks: [{ name: 'Declutter coat closet', frequencyDays: 180, durationMinutes: 20, icon: 'DoorClosed' }] },
    ],
  },
  office: {
    windowsCurtains: true,
    base: [{ name: 'Dust surfaces', frequencyDays: 7, durationMinutes: 10, icon: 'Feather' }],
    equipment: [
      { key: 'desk', icon: 'LampDesk', label: 'Desk & screens', tasks: [{ name: 'Wipe desk, keyboard & screen', frequencyDays: 7, durationMinutes: 10, icon: 'LampDesk' }] },
      { key: 'shelf', icon: 'Library', label: 'Bookshelf', tasks: [{ name: 'Dust bookshelf', frequencyDays: 30, durationMinutes: 10, icon: 'Library' }] },
      { key: 'plants', icon: 'Sprout', label: 'Plants', tasks: [{ name: 'Water plants', frequencyDays: 4, durationMinutes: 5, icon: 'Droplets' }] },
    ],
  },
  balcony: {
    noFloor: true,
    base: [{ name: 'Sweep floor', frequencyDays: 14, durationMinutes: 10, icon: 'Wind', sizeScale: true }],
    equipment: [
      { key: 'chair', icon: 'Armchair', label: 'Outdoor furniture', tasks: [{ name: 'Wipe outdoor furniture', frequencyDays: 30, durationMinutes: 10, icon: 'Armchair' }] },
      { key: 'plants', icon: 'Sprout', label: 'Plants', tasks: [{ name: 'Water plants', frequencyDays: 3, durationMinutes: 5, icon: 'Droplets' }] },
      { key: 'grill', icon: 'FlameKindling', label: 'Grill', tasks: [{ name: 'Deep clean grill', frequencyDays: 90, durationMinutes: 30, icon: 'FlameKindling' }] },
    ],
  },
  other: {
    base: [{ name: 'Dust surfaces', frequencyDays: 14, durationMinutes: 10, icon: 'Feather' }],
    equipment: [
      { key: 'plants', icon: 'Sprout', label: 'Plants', tasks: [{ name: 'Water plants', frequencyDays: 4, durationMinutes: 5, icon: 'Droplets' }] },
      { key: 'mirror', icon: 'MirrorRectangular', label: 'Mirror / glass', tasks: [{ name: 'Wipe glass', frequencyDays: 14, durationMinutes: 5, icon: 'MirrorRectangular' }] },
    ],
  },
}

export const TYPE_META: Record<RoomType, string> = {
  kitchen: 'Kitchen',
  bathroom: 'Bathroom',
  hallway: 'Hallway',
  bedroom: 'Bedroom',
  'living-room': 'Living room',
  office: 'Office',
  balcony: 'Balcony',
  other: 'Other',
}

/** The 5 rooms offered pre-toggled ON in room selection. */
export const DEFAULT_ROOM_TYPES: RoomType[] = ['kitchen', 'bathroom', 'hallway', 'bedroom', 'living-room']
/** All 8 room types, in the "add another room" wheel's order. */
export const WHEEL_ROOM_TYPES: RoomType[] = [
  'bedroom',
  'bathroom',
  'kitchen',
  'living-room',
  'hallway',
  'office',
  'balcony',
  'other',
]

export const SIZES: Array<{ key: SizeClass; label: string; range: string; scale: number }> = [
  { key: 'S', label: 'Small', range: '< 10 m²', scale: 0.7 },
  { key: 'M', label: 'Medium', range: '10–20 m²', scale: 1 },
  { key: 'L', label: 'Large', range: '> 20 m²', scale: 1.4 },
]

export const WINDOWS: Array<{ count: WindowCount; label: string; durationMinutes: number }> = [
  { count: 0, label: 'None', durationMinutes: 0 },
  { count: 1, label: '1 window', durationMinutes: 10 },
  { count: 2, label: '2 windows', durationMinutes: 15 },
  { count: 3, label: '3 or more', durationMinutes: 25 },
]

export const FLOORS: Array<{ key: NonNullable<FloorType>; label: string; description: string }> = [
  { key: 'hard', label: 'Hard floor', description: 'wood, tile, laminate' },
  { key: 'carpet', label: 'Carpet', description: 'wall-to-wall' },
  { key: 'mixed', label: 'Hard + rugs', description: 'the mixed classic' },
]

export const FREQ_STEPS = [1, 2, 3, 4, 5, 7, 10, 14, 21, 30, 45, 60, 90, 120, 180]
const FREQ_LABELS: Record<number, string> = {
  1: 'every day',
  7: 'every week',
  14: 'every 2 weeks',
  21: 'every 3 weeks',
  30: 'every month',
  60: 'every 2 months',
  90: 'every 3 months',
  120: 'every 4 months',
  180: 'every 6 months',
}

export function fmtFreq(days: number): string {
  return FREQ_LABELS[days] ?? `every ${days} days`
}

// ---------------------------------------------------------------------------
// Task generation: room config + home profile -> concrete suggested tasks.
// ---------------------------------------------------------------------------

export type TaskStatus = 'fresh' | 'soon' | 'overdue'

export interface DraftRoomConfig {
  type: RoomType
  sizeClass: SizeClass
  windows: WindowCount
  floor: FloorType
  /** Library equipment keys, plus free-text custom items prefixed `custom:`. */
  equipment: string[]
}

export interface HomeProfile {
  pets: boolean
  plants: boolean
  wfh: boolean
}

/** A generated suggestion, mid-decision in the wizard's task-by-task screen. */
export interface SuggestedTask {
  name: string
  frequencyDays: number
  /** The library's original suggestion, so the UI can show "suggested X" once the user deviates. */
  suggestedFrequencyDays: number
  durationMinutes: number
  icon: string
  status: TaskStatus
  /** null = undecided, true = added, false = skipped. */
  added: boolean | null
}

const applyModifiers = (
  t: TaskTemplate,
  sizeFactor: number,
  pets: boolean,
): { frequencyDays: number; durationMinutes: number } => {
  let frequencyDays = t.frequencyDays
  let durationMinutes = t.durationMinutes
  if (t.pets && pets) frequencyDays = Math.max(1, Math.round(frequencyDays / 2))
  if (t.sizeScale) durationMinutes = Math.max(5, Math.round((durationMinutes * sizeFactor) / 5) * 5)
  return { frequencyDays, durationMinutes }
}

/**
 * Generates the suggested-task list for a configured room, applying the
 * pets/size/floor/window modifiers exactly as the mockup's `buildTasks()`.
 * Every task starts 'soon'/undecided — the task-by-task screen is where the
 * user sets each one's actual current-state chip and decides add/skip.
 */
export function buildTasks(room: DraftRoomConfig, profile: HomeProfile): SuggestedTask[] {
  const lib = LIB[room.type]
  const sizeFactor = SIZES.find((s) => s.key === room.sizeClass)?.scale ?? 1
  const out: SuggestedTask[] = []

  const add = (t: TaskTemplate) => {
    const { frequencyDays, durationMinutes } = applyModifiers(t, sizeFactor, profile.pets)
    out.push({
      name: t.name,
      frequencyDays,
      suggestedFrequencyDays: frequencyDays,
      durationMinutes,
      icon: t.icon,
      status: 'soon',
      added: null,
    })
  }

  lib.base.forEach(add)

  if (!lib.noFloor && room.floor) {
    FLOOR_TASKS[room.floor].forEach((t) => {
      add(lib.floorMop7 && t.name.startsWith('Mop') ? { ...t, frequencyDays: 7 } : t)
    })
  }

  lib.equipment.filter((e) => room.equipment.includes(e.key)).forEach((e) => e.tasks.forEach(add))

  room.equipment
    .filter((k) => k.startsWith('custom:'))
    .forEach((k) =>
      add({ name: `Clean ${k.slice(7).toLowerCase()}`, frequencyDays: 30, durationMinutes: 15, icon: 'Sparkles' }),
    )

  if (room.windows > 0) {
    const w = WINDOWS.find((w) => w.count === room.windows)
    add({ name: 'Clean windows inside', frequencyDays: 60, durationMinutes: w?.durationMinutes ?? 15, icon: 'PanelsTopLeft' })
    if (lib.windowsCurtains) {
      add({ name: 'Wash curtains / dust blinds', frequencyDays: 120, durationMinutes: 20, icon: 'Blinds' })
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// Day-one baseline: Fresh/Due soon/Overdue -> a believable lastCompletedDate.
// ---------------------------------------------------------------------------

const STATUS_PERCENT_DUE: Record<TaskStatus, number> = { fresh: 5, soon: 70, overdue: 130 }

/**
 * Converts a task's chosen state chip into a `lastCompletedDate`, so day one
 * looks like real life instead of a blank slate: percent-of-cycle-elapsed by
 * status (5/70/130%) plus random jitter in [-10, +10] points, clamped >= 0.
 */
export function baselineLastCompletedDate(
  frequencyDays: number,
  status: TaskStatus,
  now: number = Date.now(),
): number {
  const jitter = Math.random() * 20 - 10
  const percentDue = Math.max(0, STATUS_PERCENT_DUE[status] + jitter)
  return Math.round(now - (percentDue / 100) * frequencyDays * MS_PER_DAY)
}

/**
 * The "suggested" frequency for an existing task, derived (not stored) by
 * matching its name against the room's current buildTasks() output — if the
 * room's setup changed since the task was created, this reflects the
 * *current* suggestion, not whatever the task was originally added with.
 * Renamed tasks and free-text "own" tasks won't match anything and get
 * `null` (no suggested line at all), which is the intended behavior.
 */
export function suggestedFrequencyForTask(
  taskName: string,
  room: DraftRoomConfig,
  profile: HomeProfile,
): number | null {
  const match = buildTasks(room, profile).find((t) => t.name === taskName)
  return match ? match.frequencyDays : null
}
