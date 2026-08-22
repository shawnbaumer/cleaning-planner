// Synthesized completion sound (no audio file) — a soft rising three-note
// chord played via the Web Audio API when a task is marked Complete.

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

/** Plays the soft rising completion chord, if sound is enabled. Call only from the Complete action. */
export function playCompleteSound(): void {
  if (!isSoundEnabled()) return

  const ctx = ensureAudioContext()
  if (!ctx) return
  void ctx.resume().catch(() => {})

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
