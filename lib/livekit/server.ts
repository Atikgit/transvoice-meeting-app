import 'server-only'
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk'
import { serverEnv } from '@/lib/env'
import type { MeetingRole } from '@/lib/meetings/load'

/** One LiveKit room per call session. */
export const roomNameFor = (sessionId: string) => `tv-${sessionId}`

const ROOM_PATTERN = /^tv-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

export function sessionIdFromRoom(roomName: string | undefined): string | null {
  return ROOM_PATTERN.exec(roomName ?? '')?.[1] ?? null
}

/** Token lifetime: long enough for a meeting, short enough to limit a leaked token. */
export const TOKEN_TTL = '2h'

/** HTTPS API URL for the server SDK (LIVEKIT_URL, else the public wss URL). */
export function livekitApiUrl(): string {
  const env = serverEnv()
  const url = new URL(env.LIVEKIT_URL ?? env.NEXT_PUBLIC_LIVEKIT_URL)
  if (url.protocol === 'wss:') url.protocol = 'https:'
  if (url.protocol === 'ws:') url.protocol = 'http:'
  return url.origin
}

let service: RoomServiceClient | undefined
export function roomService(): RoomServiceClient {
  const env = serverEnv()
  service ??= new RoomServiceClient(livekitApiUrl(), env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET)
  return service
}

export interface ParticipantMetadata {
  name: string
  spokenLang: string
  listenLang: string
  role: MeetingRole
}

/**
 * Join token for one room. Clients may publish audio, camera and screen share and subscribe,
 * but never send data packets: control and translation messages come from the server.
 */
export async function createParticipantToken({
  identity,
  room,
  metadata,
}: {
  identity: string
  room: string
  metadata: ParticipantMetadata
}): Promise<string> {
  const env = serverEnv()
  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity,
    name: metadata.name,
    metadata: JSON.stringify(metadata),
    ttl: TOKEN_TTL,
  })
  token.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [
      TrackSource.MICROPHONE,
      TrackSource.CAMERA,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ],
    canSubscribe: true,
    canPublishData: false,
    canUpdateOwnMetadata: false,
  })
  return token.toJwt()
}
