'use client'

import { useState } from 'react'
import { useMediaDeviceSelect } from '@livekit/components-react'
import { Settings2, X } from 'lucide-react'

const selectClass =
  'w-full rounded-xl border border-white/10 bg-[#151c2a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-300'

function DeviceSelect({ kind, label }: { kind: MediaDeviceKind; label: string }) {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind })
  if (devices.length === 0) return null
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <select
        value={activeDeviceId}
        onChange={(e) => void setActiveMediaDevice(e.target.value)}
        className={selectClass}
      >
        {devices.map((device, index) => (
          <option key={device.deviceId || index} value={device.deviceId}>
            {device.label || `${label} ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Speaker selection needs HTMLMediaElement.setSinkId (not in Safari/iOS or Firefox Android). */
function canChooseSpeaker(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
}

/** Microphone / camera / speaker switching during the meeting. */
export function DeviceMenu() {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Devices"
        aria-expanded={open}
        title="Devices"
        className="inline-flex h-11 min-w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[.04] px-3 text-slate-200 transition hover:bg-white/[.09] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
      >
        <Settings2 size={17} aria-hidden />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Devices"
          className="absolute bottom-14 left-1/2 z-40 w-72 -translate-x-1/2 space-y-3 rounded-2xl border border-white/10 bg-[#151b29] p-4 shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-white">Devices</p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close devices"
              className="text-slate-400 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
          <DeviceSelect kind="audioinput" label="Microphone" />
          <DeviceSelect kind="videoinput" label="Camera" />
          {canChooseSpeaker() && <DeviceSelect kind="audiooutput" label="Speaker" />}
        </div>
      )}
    </div>
  )
}
