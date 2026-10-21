import { Camera, CameraOff, MessageCircle, Mic, MicOff, PhoneOff, Users } from 'lucide-react'
import { Button } from '@/components/common/button'

export function ControlBar({
  mic,
  camera,
  unreadCount,
  onToggleMic,
  onToggleCamera,
  onInvite,
  onToggleChat,
  onLeave,
}: {
  mic: boolean
  camera: boolean
  unreadCount: number
  onToggleMic: () => void
  onToggleCamera: () => void
  onInvite: () => void
  onToggleChat: () => void
  onLeave: () => void
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-center gap-2 border-t border-white/[.08] pt-4">
      <button
        onClick={onToggleMic}
        className={`flex size-11 items-center justify-center rounded-xl border transition ${mic ? 'border-cyan-300/40 bg-cyan-300/15 text-cyan-200' : 'border-rose-500/40 bg-rose-500/15 text-rose-300'}`}
        title={mic ? 'Mute Mic' : 'Unmute Mic'}
      >
        {mic ? <Mic size={18} /> : <MicOff size={18} />}
      </button>

      <button
        onClick={onToggleCamera}
        className={`flex size-11 items-center justify-center rounded-xl border transition ${camera ? 'border-cyan-300/40 bg-cyan-300/15 text-cyan-200' : 'border-rose-500/40 bg-rose-500/15 text-rose-300'}`}
        title={camera ? 'Turn off camera' : 'Turn on camera'}
      >
        {camera ? <Camera size={18} /> : <CameraOff size={18} />}
      </button>

      <Button variant="outline" onClick={onInvite}>
        <Users size={15} /> Invite Partner
      </Button>

      <Button variant="outline" onClick={onToggleChat} className="relative">
        <MessageCircle size={15} /> Chat
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-cyan-400 text-[10px] font-bold text-slate-950">
            {unreadCount}
          </span>
        )}
      </Button>

      <Button variant="danger" onClick={onLeave}>
        <PhoneOff size={15} /> Leave
      </Button>
    </div>
  )
}
