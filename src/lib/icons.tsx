import {
  Feather,
  Wind,
  Droplets,
  Bed,
  BedDouble,
  AppWindow,
  ShowerHead,
  Microwave,
  Trash2,
  WashingMachine,
  SprayCan,
  Sparkles,
  Bath,
  CookingPot,
  Sofa,
  Home,
  DoorOpen,
  DoorClosed,
  Monitor,
  Sun,
  Package,
  Refrigerator,
  Utensils,
  Fan,
  Sprout,
  Flame,
  FlameKindling,
  MirrorRectangular,
  Table2,
  Library,
  Footprints,
  Armchair,
  Shirt,
  Toilet,
  Blinds,
  PanelsTopLeft,
  LampDesk,
  type LucideIcon,
} from 'lucide-react'
import type { RoomType } from './db'

/**
 * A monochrome line icon inferred from a task's name by keyword — e.g. a
 * feather for "Dust". Returns a Lucide component (stroke uses currentColor, so
 * it inherits text color and adapts to dark mode). Falls back to a generic
 * sparkle so custom/unknown tasks still get an icon. First match wins, so order
 * the more specific keywords first.
 */
export function taskIcon(name: string): LucideIcon {
  const n = name.toLowerCase()
  if (n.includes('dust')) return Feather
  if (n.includes('vacuum') || n.includes('sweep')) return Wind
  if (n.includes('mop') || n.includes('floor')) return Droplets
  if (n.includes('sheet') || n.includes('bed') || n.includes('linen')) return Bed
  if (n.includes('window') || n.includes('glass') || n.includes('mirror')) return AppWindow
  if (n.includes('bath') || n.includes('shower') || n.includes('toilet') || n.includes('sink'))
    return ShowerHead
  if (n.includes('microwave') || n.includes('oven') || n.includes('fridge') || n.includes('dish'))
    return Microwave
  if (n.includes('trash') || n.includes('garbage') || n.includes('bin')) return Trash2
  if (n.includes('laundry') || n.includes('wash')) return WashingMachine
  if (n.includes('counter') || n.includes('surface') || n.includes('wipe')) return SprayCan
  return Sparkles
}

/** A monochrome line icon for a room, chosen by its type. */
export function roomIcon(type: RoomType): LucideIcon {
  switch (type) {
    case 'kitchen':
      return CookingPot
    case 'bathroom':
      return Bath
    case 'hallway':
      return DoorOpen
    case 'bedroom':
      return BedDouble
    case 'living-room':
      return Sofa
    case 'office':
      return Monitor
    case 'balcony':
      return Sun
    default:
      return Package
  }
}

/**
 * Every lucide icon name usable as a `Task.icon` value or a suggestion-
 * library equipment icon — the library (`src/lib/library.ts`) and the setup
 * wizard reference icons by these string keys (the lucide component's own
 * name) rather than importing components directly, since `Task.icon` has to
 * be a plain string to persist in IndexedDB.
 */
export const ICON_REGISTRY: Record<string, LucideIcon> = {
  Feather,
  Wind,
  Droplets,
  Bed,
  BedDouble,
  AppWindow,
  ShowerHead,
  Microwave,
  Trash2,
  WashingMachine,
  SprayCan,
  Sparkles,
  Bath,
  CookingPot,
  Sofa,
  Home,
  DoorOpen,
  DoorClosed,
  Monitor,
  Sun,
  Package,
  Refrigerator,
  Utensils,
  Fan,
  Sprout,
  Flame,
  FlameKindling,
  MirrorRectangular,
  Table2,
  Library,
  Footprints,
  Armchair,
  Shirt,
  Toilet,
  Blinds,
  PanelsTopLeft,
  LampDesk,
}

/** Resolves an icon name (as stored in `Task.icon` or the library) to its component, if known. */
export function resolveIcon(name: string | undefined): LucideIcon | undefined {
  return name ? ICON_REGISTRY[name] : undefined
}

/** A task's icon: its explicit `icon` field if set and known, else the keyword-inferred fallback. */
export function iconForTask(task: { name: string; icon?: string }): LucideIcon {
  return resolveIcon(task.icon) ?? taskIcon(task.name)
}
