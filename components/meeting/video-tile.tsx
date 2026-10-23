'use client'

import { useEffect, useRef } from 'react'
import { Mic, MicOff, Users } from 'lucide-react'

export function VideoTile({
  name,
  initials,
  color,
  active,
  cameraOn,
  isLocal,
  stream,
  isWaiting = false,
}: {
  name: string
  initials: string
  color: string
  active?: boolean
  cameraOn: boolean
  isLocal?: boolean
  stream?: MediaStream | null
  isWaiting?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && stream && cameraOn) {
      videoRef.current.srcObject = stream
    }
  }, [stream, cameraOn])

  return (
    <div
      data-testid="video-tile"
      className={`relative h-full w-full overflow-hidden rounded-2xl border ${active ? 'border-cyan-300/50 shadow-[0_0_22px_rgba(103,232,249,.15)]' : 'border-white/10'} ${color}`}
    >
      {cameraOn && stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="h-full w-full object-cover"
        />
      ) : isWaiting ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-400">
          <div className="flex size-14 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 text-cyan-300 animate-pulse">
            <Users size={24} />
          </div>
          <p className="text-sm font-medium text-slate-200">Waiting for partner to join...</p>
          <p className="text-xs text-slate-500">
            Click &apos;Invite Partner&apos; below to share link
          </p>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center">
          <div className="flex size-24 items-center justify-center rounded-full border-4 border-white/15 bg-cyan-700 text-2xl font-semibold text-white">
            {initials}
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-slate-950/90 to-transparent p-4 pt-12">
        <div>
          <p className="text-sm font-semibold text-white">{name}</p>
          <p className="text-[11px] text-slate-400">{cameraOn ? 'Camera Active' : 'Camera Off'}</p>
        </div>
        <div className="rounded-lg bg-slate-950/60 p-2">
          {active ? (
            <Mic size={14} className="text-cyan-300 animate-pulse" />
          ) : (
            <MicOff size={14} className="text-rose-400" />
          )}
        </div>
      </div>
    </div>
  )
}
