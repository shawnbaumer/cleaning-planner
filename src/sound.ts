// Synthesized completion sound (no audio file), via the Web Audio API, split
// into two parts synced to the tile's completion animation (see App.tsx's
// playReset): a quiet descending marimba run while the drop bar drains, then
// a soft rising chord exactly when the tile blinks/resets.

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

// Drain run: a descending 14-note marimba figure (E5 pentatonic down to A2,
// two extra pentatonic octaves past the original 9-note run so the same span
// packs in more, faster notes), quiet and lowpass-filtered so it reads as a
// soft mallet run under the drop bar's own drain rather than a competing
// tone. Kept noticeably quieter than the chord (NOTE_PEAK_GAIN vs
// CHORD's PEAK_GAIN) so the chord's "ping" reads as the payoff. Notes bunch
// up toward the end (MARIMBA_SPREAD_EXPONENT < 1) for a slight speed-up.
const MARIMBA_HZ = [659, 587, 523, 440, 392, 330, 294, 262, 220, 196, 165, 147, 131, 110]
const MARIMBA_SPREAD_EXPONENT = 0.85
// Fraction of the total drain duration reserved for the last note's own
// decay — the run's note-start span is shortened by exactly this much, so
// last-note-start + its envelope lands precisely at the drain's own end
// (see playDrainSound), whatever duration it's actually called with.
const NOTE_ENVELOPE_FRACTION = 0.1
const NOTE_ATTACK_S = 0.004
const NOTE_PEAK_GAIN = 0.035
const NOTE_FILTER_START_MULT = 3
const NOTE_FILTER_END_MULT = 1.2
// Attack click: a brief higher-pitched tick layered under each note's onset
// to suggest a mallet strike.
const CLICK_FREQ_MULT = 4
const CLICK_PEAK_FRACTION = 0.28
const CLICK_ATTACK_S = 0.001
const CLICK_ENVELOPE_S = 0.04

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
 * Plays the quiet descending marimba run, spread across exactly the drop
 * bar's own drain duration — the last note's own decay is timed to end
 * precisely when `durationMs` is up, so the sound's total length always
 * matches the visual drain exactly, however long that is. Call at the
 * moment that animation starts, passing its actual duration constant, so
 * the two stay in sync.
 */
export function playDrainSound(durationMs: number): void {
  const ctx = getReadyContext()
  if (!ctx) return

  const now = ctx.currentTime
  const durationS = durationMs / 1000
  const n = MARIMBA_HZ.length
  const noteEnvelopeS = durationS * NOTE_ENVELOPE_FRACTION
  const spanS = durationS - noteEnvelopeS

  MARIMBA_HZ.forEach((hz, i) => {
    const start = now + spanS * Math.pow(i / (n - 1), MARIMBA_SPREAD_EXPONENT)

    // Main note: sine through a lowpass filter sweeping downward, giving the
    // mallet-strike's initial brightness a quick decay toward a rounder tone.
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = hz

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(hz * NOTE_FILTER_START_MULT, start)
    filter.frequency.exponentialRampToValueAtTime(hz * NOTE_FILTER_END_MULT, start + noteEnvelopeS)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(FLOOR_GAIN, start)
    gain.gain.exponentialRampToValueAtTime(NOTE_PEAK_GAIN, start + NOTE_ATTACK_S)
    gain.gain.exponentialRampToValueAtTime(FLOOR_GAIN, start + noteEnvelopeS)

    osc.connect(filter)
    filter.connect(gain)
    gain.connect(ctx.destination)
    osc.start(start)
    osc.stop(start + noteEnvelopeS + 0.02)

    // Attack click: unfiltered, much shorter, layered at the same start time.
    const click = ctx.createOscillator()
    click.type = 'sine'
    click.frequency.value = hz * CLICK_FREQ_MULT

    const clickGain = ctx.createGain()
    clickGain.gain.setValueAtTime(FLOOR_GAIN, start)
    clickGain.gain.exponentialRampToValueAtTime(NOTE_PEAK_GAIN * CLICK_PEAK_FRACTION, start + CLICK_ATTACK_S)
    clickGain.gain.exponentialRampToValueAtTime(FLOOR_GAIN, start + CLICK_ENVELOPE_S)

    click.connect(clickGain)
    clickGain.connect(ctx.destination)
    click.start(start)
    click.stop(start + CLICK_ENVELOPE_S + 0.02)
  })
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
