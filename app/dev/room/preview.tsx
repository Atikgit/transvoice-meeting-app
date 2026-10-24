'use client'

import { MeetingLayout } from '@/components/meeting/meeting-layout'
import { VideoTile } from '@/components/meeting/video-tile'

const noop = () => {}

/** Fake-data room for /dev/room (layout checks only). */
export function RoomPreview({ role, live }: { role: 'host' | 'guest'; live: boolean }) {
  return (
    <MeetingLayout
      header={{
        title: 'Translated meeting',
        status: live ? 'live' : 'waiting',
        statusLabel: live ? 'Live 01:23' : 'Waiting for partner…',
        minutesLabel: '15 min remaining',
      }}
      tiles={[
        <VideoTile
          key="partner"
          name="Waiting for partner..."
          initials="PA"
          color="bg-teal-900/60"
          isWaiting
        />,
        <VideoTile
          key="self"
          name="Preview User (You)"
          initials="You"
          color="bg-indigo-900/60"
          label="Camera off"
          pipOnMobile
        />,
      ]}
      caption={{
        translating: false,
        originalText: '',
        translatedText: '',
        placeholder: live ? 'Listening…' : 'Translation starts when the meeting starts.',
      }}
      controls={{
        mic: true,
        camera: true,
        unreadCount: 0,
        role,
        live,
        onToggleMic: noop,
        onToggleCamera: noop,
        onInvite: noop,
        onToggleChat: noop,
        onStart: noop,
        onEnd: noop,
        onLeave: noop,
      }}
    />
  )
}
