// Synthesized completion sound (no audio file), via the Web Audio API, split
// into two parts synced to the tile's completion animation (see App.tsx's
// playReset): a quiet descending "drain" sweep while the drop bar empties,
// then a soft rising chord exactly when the tile blinks/resets.

const STORAGE_KEY = 'cp.soundEnabled'

// E5, B5, E6 — a soft, rounded rising chord, not a cartoonish "ding".
const CHORD_HZ = [659, 988, 1318]
const NOTE_STAGGER_S = 0.03
const ATTACK_S = 0.006
// Exponential ramps can't target exactly 0, so the envelope floors here
// instead of true silence — inaudible, but keeps the Web Audio API happy.
const FLOOR_GAIN = 0.0001
const PEAK_GAIN = 0.16
// Each note's full envelope (attack + release), measured from its own start —
// with the last note staggered in at 2 * NOTE_STAGGER_S, the whole chord
// runs for roughly ENVELOPE_TOTAL_S + 2 * NOTE_STAGGER_S ≈ 400ms.
const ENVELOPE_TOTAL_S = 0.35

// Drain sweep: descending, quiet, and lowpass-filtered so it reads as a soft
// "whoosh" under the drop bar's own drain rather than a competing tone.
const DRAIN_START_HZ = 880
const DRAIN_END_HZ = 440
const DRAIN_GAIN = 0.12
const DRAIN_FILTER_HZ = 1200

let audioContext: AudioContext | null = null

function getAudioContextCtor(): (new () => AudioContext) | undefined {
  const w = window as typeof window & { webkitAudioContext?: new () => AudioContext }
  return w.AudioContext || w.webkitAudioContext
}

/** Creates the AudioContext on first use only — never at module load. */
function ensureAudioContext(): AudioContext | null {
  if (audioContext) return audioContext
  const Ctor = getAudioContextCtor()
  if (!Ctor) return null
  audioContext = new Ctor()
  return audioContext
}

// iOS Safari suspends a freshly created AudioContext until it's resumed from
// inside a user gesture — a one-time pointerdown anywhere in the document is
// the earliest such gesture available, so it's used to unlock audio well
// before the user ever taps Complete. playCompleteSound() also resumes right
// before playing as a second guard, in case the context is still suspended
// (e.g. this listener hasn't fired yet, or iOS re-suspended it).
document.addEventListener(
  'pointerdown',
  () => {
    ensureAudioContext()?.resume().catch(() => {})
  },
  { once: true },
)

export function isSoundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled))
  } catch {
    // localStorage unavailable (e.g. private mode) — the choice just won't persist.
  }
}

/** Shared setup for both sounds: bails out if sound is off or Web Audio is unavailable, else resumes and returns the context. */
function getReadyContext(): AudioContext | null {
  if (!isSoundEnabled()) return null
  const ctx = ensureAudioContext()
  if (!ctx) return null
  void ctx.resume().catch(() => {})
  return ctx
}

/**
 * Plays the quiet descending drain sweep, timed to last exactly as long as
 * the drop bar's own drain animation. Call at the moment that animation
 * starts, passing its actual duration constant, so the two stay in sync.
 */
export function playDrainSound(durationMs: number): void {
  const ctx = getReadyContext()
  if (!ctx) return

  const now = ctx.currentTime
  const durationS = durationMs / 1000

  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(DRAIN_START_HZ, now)
  osc.frequency.exponentialRampToValueAtTime(DRAIN_END_HZ, now + durationS)

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = DRAIN_FILTER_HZ

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(FLOOR_GAIN, now)
  gain.gain.exponentialRampToValueAtTime(DRAIN_GAIN, now + ATTACK_S)
  gain.gain.exponentialRampToValueAtTime(FLOOR_GAIN, now + durationS)

  osc.connect(filter)
  filter.connect(gain)
  gain.connect(ctx.destination)

  osc.start(now)
  osc.stop(now + durationS + 0.02)
}

/** Plays the soft rising completion chord, if sound is enabled. Call exactly when the tile blinks/resets. */
export function playCompleteSound(): void {
  const ctx = getReadyContext()
  if (!ctx) return

  const now = ctx.currentTime
  for (const [i, freq] of CHORD_HZ.entries()) {
    const start = now + i * NOTE_STAGGER_S

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(FLOOR_GAIN, start)
    gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, start + ATTACK_S)
    gain.gain.exponentialRampToValueAtTime(FLOOR_GAIN, start + ENVELOPE_TOTAL_S)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(start)
    osc.stop(start + ENVELOPE_TOTAL_S + 0.02)
  }
}
