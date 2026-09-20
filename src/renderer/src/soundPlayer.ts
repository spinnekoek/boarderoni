import { SERVER_PORT } from '@shared/constants'
import type { CustomSound } from '@shared/sounds'

// Plays a sound:play message's audio (see runPlaySoundAction in
// main/index.ts). Lives outside the React tree deliberately: a sound has no
// rendered representation, and tying playback to a mounted component would
// mean it stops working the moment that component unmounts — including when
// the editor window is hidden to tray, which is exactly when a 'server'
// target still needs to play.
//
// The desktop editor window is loaded from SERVER_PORT in both dev and
// packaged builds (see createEditorWindow), so a same-origin relative URL
// would usually work — but a deployed view client on a phone is on that same
// origin too, and DevTools/file:// edge cases aren't worth the ambiguity, so
// the host is resolved explicitly the same way DeckPicker's own apiUrl does.
function soundUrl(sound: CustomSound): string {
  const host = window.location.hostname || 'localhost'
  return `http://${host}:${SERVER_PORT}/sounds/${sound.id}`
}

// Every Audio element currently playing, so nothing is garbage-collected
// mid-playback — an element with no reference held can be collected while
// still audible in some engines, cutting the sound off. Removed on end/error.
const playing = new Set<HTMLAudioElement>()

export function playSound(sound: CustomSound, volume: number, startAtMs: number): void {
  const audio = new Audio(soundUrl(sound))
  audio.volume = Math.min(1, Math.max(0, volume))
  playing.add(audio)

  function release(): void {
    playing.delete(audio)
  }
  audio.addEventListener('ended', release)
  audio.addEventListener('error', release)

  // currentTime can only be set once the browser knows the duration, so
  // seeking has to wait for metadata rather than happening up front —
  // setting it on a fresh element is silently ignored. This is what makes
  // "start at ms" work for skipping the dead air at the front of a sample.
  function start(): void {
    if (startAtMs > 0) {
      const seconds = startAtMs / 1000
      // Guard against an offset past the end of the file, which would
      // otherwise either throw or start at a clamped position and play
      // nothing audible.
      if (Number.isFinite(audio.duration) && seconds >= audio.duration) {
        release()
        return
      }
      audio.currentTime = seconds
    }
    // Rejects when the browser blocks autoplay. The desktop window sets
    // autoplayPolicy: 'no-user-gesture-required' (see createEditorWindow) so
    // a sound fired by a rule, with nobody touching the machine, still
    // plays; a view client in a real browser has usually had a tap by the
    // time any action fires. Logged rather than thrown — a silent failure
    // here should never take down whatever else the sequence was doing.
    void audio.play().catch((err) => {
      console.warn('[boarderoni] sound playback blocked', err)
      release()
    })
  }

  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) start()
  else audio.addEventListener('loadedmetadata', start, { once: true })
}
