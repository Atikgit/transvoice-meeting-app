import { Room } from 'livekit-client'

/** Phones, where audio defaults to the earpiece during a call. */
export function isPhone(): boolean {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPod/i.test(navigator.userAgent)
}

/** Output selection (setSinkId) exists on Chrome / Android, not on iOS Safari or Firefox. */
export function canSelectOutput(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
}

const SPEAKER = /speaker|loud/i
const NOT_SPEAKER = /headset|headphone|earpiece|receiver|bluetooth|buds|airpods/i

/**
 * Best effort: on a phone whose browser lets pages choose the output, switch LiveKit's audio
 * (and our translated-clip context) to the loudspeaker. Returns whether it switched. iOS Safari
 * cannot do this; there the system route (control centre) decides.
 */
export async function routeToLoudspeaker(room: Room, context?: AudioContext | null) {
  if (!isPhone() || !canSelectOutput()) return false
  try {
    const outputs = await Room.getLocalDevices('audiooutput', false)
    const speaker = outputs.find((d) => SPEAKER.test(d.label) && !NOT_SPEAKER.test(d.label))
    if (!speaker) return false
    await room.switchActiveDevice('audiooutput', speaker.deviceId)
    const sinkable = context as
      (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null
    await sinkable?.setSinkId?.(speaker.deviceId).catch(() => {})
    return true
  } catch {
    return false
  }
}
