import { SERVER_PORT } from '@shared/constants'
import type { CustomSound } from '@shared/sounds'
import { contentAuthParams } from './id'

// Plays a sound:play message's audio (see runPlaySoundAction in
// main/index.ts). Lives outside the React tree deliberately: a sound has no
// rendered representation, and tying playback to a mounted component would
// mean it stops working the moment that component unmounts — including when
// the editor window is hidden to tray, which is exactly when a 'server'
// target still needs to play.
//
// The desktop editor window is loaded from SERVER_PORT in both dev and
// packaged builds (see createEditorWindow), so a same-origin relative URL
// would usually work — but a client on a phone is on that same
// origin too, and DevTools/file:// edge cases aren't worth the ambiguity, so
// the host is resolved explicitly the same way DeckPicker's own apiUrl does.
// /sounds/ is device-gated like fonts — see id.ts's contentAuthParams.
function soundUrl(sound: CustomSound): string {
  const host = window.location.hostname || 'localhost'
  return `http://${host}:${SERVER_PORT}/sounds/${sound.id}?${contentAuthParams()}`
}

// One AudioContext for the whole renderer, created lazily on first playback
// (constructing one before any user gesture throws/warns on some browsers).
// Suspended-until-resumed is handled in playSound below, the same
// autoplay-gate reasoning the old HTMLAudioElement version had.
let audioCtx: AudioContext | null = null
function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext()
  return audioCtx
}

// Decoded PCM per sound id, fetched and decoded exactly once no matter how
// many times it's played. This is the actual fix for presses "bursting":
// the old version did `new Audio(url)` on every single play, so a rapid
// sequence of presses kicked off that many independent fetch+decode
// pipelines, each with its own (similar) latency — they tended to finish
// decoding and start audible playback at nearly the same moment instead of
// staying spaced out like the presses that triggered them. A cached,
// pre-decoded buffer turns playback into a synchronous
// AudioBufferSourceNode.start() with no per-play I/O or decode latency to
// bunch up.
const bufferCache = new Map<string, Promise<AudioBuffer>>()

function getBuffer(sound: CustomSound): Promise<AudioBuffer> {
  const cached = bufferCache.get(sound.id)
  if (cached) return cached
  const promise = fetch(soundUrl(sound))
    .then((res) => res.arrayBuffer())
    .then((data) => getAudioCtx().decodeAudioData(data))
  // A failed fetch/decode must not permanently poison the cache — the next
  // play attempt (e.g. after the server comes back, or the sound is
  // re-uploaded) should retry from scratch rather than rejecting forever.
  promise.catch(() => bufferCache.delete(sound.id))
  bufferCache.set(sound.id, promise)
  return promise
}

export function playSound(sound: CustomSound, volume: number, startAtMs: number): void {
  const ctx = getAudioCtx()
  // Same autoplay-gate reasoning the old version's audio.play().catch had:
  // a context created (or left suspended) with nobody having interacted
  // yet should still work on the desktop editor (autoplayPolicy:
  // 'no-user-gesture-required'), and resume() is a no-op if already running.
  void ctx.resume().catch(() => {})

  void getBuffer(sound)
    .then((buffer) => {
      const offsetSeconds = startAtMs > 0 ? startAtMs / 1000 : 0
      // Guard against an offset past the end of the file, same as the old
      // version's currentTime-past-duration guard — starting at/after the
      // buffer's own duration would throw.
      if (offsetSeconds >= buffer.duration) return

      const gain = ctx.createGain()
      gain.gain.value = Math.min(1, Math.max(0, volume))
      gain.connect(ctx.destination)

      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(gain)
      source.start(0, offsetSeconds)
    })
    .catch((err) => {
      console.warn('[boarderoni] sound playback blocked', err)
    })
}
