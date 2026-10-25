/**
 * Camera / microphone failures, from either getUserMedia (DOMException names) or LiveKit's
 * MediaDeviceFailure ('PermissionDenied' | 'NotFound' | 'DeviceInUse' | 'Other'), as one
 * message with a recovery action. Client-safe (no server-only imports).
 */
export type MediaDevice = 'microphone' | 'camera' | 'camera or microphone'
export type MediaProblemKind = 'permission' | 'in_use' | 'not_found' | 'other'

export interface MediaProblem {
  kind: MediaProblemKind
  device: MediaDevice
  message: string
  /** What the button should do: reload after changing browser settings, or just try again. */
  recovery: 'reload' | 'retry'
}

function kindOf(error: unknown): MediaProblemKind {
  const name =
    typeof error === 'string'
      ? error
      : error instanceof Error || (typeof error === 'object' && error !== null && 'name' in error)
        ? String((error as { name: unknown }).name)
        : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
    case 'PermissionDenied':
      return 'permission'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
    case 'DeviceInUse':
      return 'in_use'
    case 'NotFoundError':
    case 'OverconstrainedError':
    case 'DevicesNotFoundError':
    case 'NotFound':
      return 'not_found'
    default:
      return 'other'
  }
}

export function describeMediaProblem(error: unknown, device: MediaDevice): MediaProblem {
  const kind = kindOf(error)
  const noun = device
  switch (kind) {
    case 'permission':
      return {
        kind,
        device,
        recovery: 'reload',
        message:
          `Your browser is blocking the ${noun}. Click the lock icon next to the address bar, ` +
          `set ${noun === 'camera' ? 'Camera' : noun === 'microphone' ? 'Microphone' : 'Camera and Microphone'} to Allow, ` +
          `then reload. On iPhone: Settings → Safari → Camera / Microphone.`,
      }
    case 'in_use':
      return {
        kind,
        device,
        recovery: 'retry',
        message: `Your ${noun} is being used by another app. Close that app (or its call), then try again.`,
      }
    case 'not_found':
      return {
        kind,
        device,
        recovery: 'retry',
        message: `No ${noun} found. Plug one in or pick another in Devices, then try again.`,
      }
    default:
      return {
        kind,
        device,
        recovery: 'retry',
        message: `The ${noun} could not be started. Try again, or choose another in Devices.`,
      }
  }
}

/** LiveKit's `kind` ("audioinput" | "videoinput" | …) as a device name. */
export function deviceFromKind(kind: string | undefined): MediaDevice {
  return kind === 'videoinput' ? 'camera' : 'microphone'
}
