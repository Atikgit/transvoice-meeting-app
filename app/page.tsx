'use client'

import { useState, useEffect, useRef } from 'react'
import {
  AudioLines, Camera, CameraOff, Check, ChevronDown,
  Link2, LockKeyhole, MessageCircle, Mic, MicOff, MonitorUp, PhoneOff,
  Plus, Send, Settings2, Sparkles, Users, Video, X, Zap, LogOut
} from 'lucide-react'
import { createClient } from '@/lib/supabase'
import { languageOptions, getVoiceName } from '@/lib/voice-settings'

// ==========================================
// ১. Lemon Squeezy ৩টি প্রোডাক্টের চেকআউট লিংক
// (আপনার ড্যাশবোর্ডের URL গুলো এখানে বসান)
// ==========================================
const LEMON_SQUEEZY_PLANS = [
  {
    name: 'Bronze Starter',
    price: '$4.44/mo',
    minutes: '120 translation mins',
    desc: '2 hours of live talk voice translation',
    checkoutUrl: 'https://transvoice-ai.lemonsqueezy.com/checkout/buy/b5d2ad29-f28a-4720-8fe8-b4c793dabbc7'
  },
  {
    name: 'Diamond Pro',
    price: '$8.88/mo',
    minutes: '300 translation mins',
    desc: '5 hours of live talk voice translation',
    checkoutUrl: 'https://transvoice-ai.lemonsqueezy.com/checkout/buy/012d90b8-34df-4427-a644-10fe30af1068'
  },
  {
    name: 'Business Standard',
    price: '$17.77/mo',
    minutes: '600 translation mins',
    desc: '10 hours of live talk voice translation',
    checkoutUrl: 'https://transvoice-ai.lemonsqueezy.com/checkout/buy/20bf599a-9c7e-419b-82ad-0d7e710adb86'
  }
]

function Button({ children, onClick, variant = 'primary', className = '', disabled = false }: {
  children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'outline' | 'danger'; className?: string; disabled?: boolean;
}) {
  const styles = {
    primary: 'bg-cyan-300 text-slate-950 hover:bg-cyan-200',
    ghost: 'bg-white/[.06] text-slate-200 hover:bg-white/[.1]',
    outline: 'border border-white/10 bg-white/[.04] text-slate-200 hover:bg-white/[.09]',
    danger: 'bg-rose-500 text-white hover:bg-rose-400'
  }
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-[#151b29] p-6 shadow-2xl`}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={19} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-9 items-center justify-center rounded-xl bg-cyan-300 text-slate-950">
        <AudioLines size={19} strokeWidth={2.5} />
      </div>
      <div>
        <p className="font-mono text-[10px] font-bold tracking-[.22em] text-cyan-300">TRANSVOICE</p>
        <p className="text-[10px] text-slate-500">Meet without limits</p>
      </div>
    </div>
  )
}

function InviteModal({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const link = typeof window !== 'undefined' ? `${window.location.origin}/?room=${roomId}&view=join` : ''

  return (
    <Modal title="Invite participant" onClose={onClose}>
      <p className="text-sm text-slate-400">Send this link to your partner to join this room.</p>
      <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/50 p-2">
        <Link2 size={16} className="ml-2 text-cyan-300" />
        <span className="min-w-0 flex-1 truncate px-2 text-xs text-slate-300">{link}</span>
        <Button onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1600) }} className="shrink-0 px-3 py-2 text-xs">
          {copied ? <><Check size={14} />Copied!</> : 'Copy link'}
        </Button>
      </div>
      <p className="mt-4 text-xs text-slate-500">Partner can join directly on mobile or PC without needing an account.</p>
    </Modal>
  )
}

function AuthModal({ onClose }: { onClose: () => void }) {
  const [signup, setSignup] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')
  const supabase = createClient()

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setMsg('')
    try {
      if (signup) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } }
        })
        if (error) throw error
        setMsg('Account created! 15 minutes added.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
      setTimeout(() => { onClose(); window.location.reload() }, 1000)
    } catch (err: any) {
      setMsg(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title={signup ? 'Create your account' : 'Welcome back'} onClose={onClose}>
      <div className="mb-5 flex rounded-xl bg-white/[.05] p-1">
        <button onClick={() => setSignup(false)} className={`flex-1 rounded-lg py-2 text-sm ${!signup ? 'bg-white/10 text-white' : 'text-slate-500'}`}>Sign in</button>
        <button onClick={() => setSignup(true)} className={`flex-1 rounded-lg py-2 text-sm ${signup ? 'bg-white/10 text-white' : 'text-slate-500'}`}>Create account</button>
      </div>
      {msg && <p className="mb-3 rounded-lg bg-cyan-950 p-2 text-center text-xs text-cyan-200">{msg}</p>}
      <form onSubmit={handleAuth} className="space-y-3">
        {signup && <input required className="w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-3 text-sm text-white outline-none" placeholder="Full name" value={fullName} onChange={e => setFullName(e.target.value)} />}
        <input required className="w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-3 text-sm text-white outline-none" placeholder="Email address" type="email" value={email} onChange={e => setEmail(e.target.value)} />
        <input required className="w-full rounded-xl border border-white/10 bg-white/[.04] px-3 py-3 text-sm text-white outline-none" placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
        <Button disabled={loading} className="w-full">{loading ? 'Please wait...' : signup ? 'Create free account' : 'Sign in'}</Button>
      </form>
    </Modal>
  )
}

function PricingModal({ user, balance, onClose }: { user: any; balance: number; onClose: () => void }) {
  const handleBuy = (checkoutUrl: string) => {
    if (!user) { alert('Please sign in first!'); return }
    window.location.href = `${checkoutUrl}?checkout[custom][user_id]=${user.id}`
  }

  return (
    <Modal title="Plans & translation minutes" onClose={onClose} wide>
      <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[.06] p-4">
        <div className="flex justify-between text-sm">
          <span className="text-slate-300">Available AI Translation</span>
          <strong className="text-cyan-200">{balance.toFixed(1)} mins remaining</strong>
        </div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {LEMON_SQUEEZY_PLANS.map((p, i) => (
          <div key={p.name} className={`rounded-2xl border p-4 ${i === 1 ? 'border-cyan-300/50 bg-cyan-300/[.07]' : 'border-white/10 bg-white/[.03]'}`}>
            <p className="text-sm font-semibold text-white">{p.name}</p>
            <p className="mt-3 text-2xl font-bold text-white">{p.price}</p>
            <p className="mt-3 text-sm text-cyan-200">{p.minutes}</p>
            <Button onClick={() => handleBuy(p.checkoutUrl)} className="mt-4 w-full text-xs">Choose plan</Button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

function JoinScreen({ onJoin, srcLang, setSrcLang, tgtLang, setTgtLang, guestName, setGuestName }: {
  onJoin: () => void; srcLang: string; setSrcLang: (v: string) => void; tgtLang: string; setTgtLang: (v: string) => void; guestName: string; setGuestName: (v: string) => void;
}) {
  const [mic, setMic] = useState(true)
  const [camera, setCamera] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let stream: MediaStream | null = null
    if (camera) {
      navigator.mediaDevices?.getUserMedia({ video: true, audio: true }).then(s => {
        stream = s
        if (videoRef.current) videoRef.current.srcObject = s
      }).catch(err => console.log('Camera preview error:', err))
    }
    return () => { stream?.getTracks().forEach(t => t.stop()) }
  }, [camera])

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0b0e16] p-5">
      <div className="w-full max-w-3xl">
        <Logo />
        <div className="mt-12 grid gap-8 md:grid-cols-[1fr_1.15fr] md:items-center">
          <div>
            <p className="font-mono text-xs uppercase tracking-[.2em] text-cyan-300">You&apos;re invited</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">Join Translated Meeting</h1>
            <p className="mt-4 text-sm leading-6 text-slate-400">Speak in your language, hear in theirs. Set your languages before joining.</p>
            <div className="mt-8 space-y-3">
              <input className="w-full rounded-xl border border-white/10 bg-white/[.04] px-4 py-3 text-sm text-white outline-none" placeholder="Your display name" value={guestName} onChange={e => setGuestName(e.target.value)} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">I Speak</label>
                  <select value={srcLang} onChange={e => setSrcLang(e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#151c2a] px-3 py-2.5 text-xs text-slate-200 outline-none">
                    {languageOptions.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-wider text-slate-500">Translate To</label>
                  <select value={tgtLang} onChange={e => setTgtLang(e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#151c2a] px-3 py-2.5 text-xs text-slate-200 outline-none">
                    {languageOptions.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <Button onClick={onJoin} className="mt-5 w-full">Join call now <ChevronDown className="-rotate-90" size={16} /></Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#192235]">
              {camera ? (
                <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
              ) : (
                <div className="flex size-14 items-center justify-center rounded-full bg-cyan-700 text-lg font-semibold text-white">You</div>
              )}
              <span className="absolute bottom-2 left-2 text-[10px] text-slate-300">Camera preview</span>
            </div>
            <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#192235]">
              <AudioLines className={`size-10 ${mic ? 'text-cyan-300 animate-pulse' : 'text-slate-600'}`} />
              <span className="absolute bottom-2 left-2 text-[10px] text-slate-300">Microphone: {mic ? 'Active' : 'Muted'}</span>
            </div>
            <button onClick={() => setCamera(!camera)} className="rounded-xl border border-white/10 bg-white/[.04] p-3 text-xs text-slate-400">
              {camera ? 'Turn camera off' : 'Turn camera on'}
            </button>
            <button onClick={() => setMic(!mic)} className="rounded-xl border border-white/10 bg-white/[.04] p-3 text-xs text-slate-400">
              {mic ? 'Mute mic' : 'Unmute mic'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}

function VideoTile({
  name, initials, color, active, cameraOn, isLocal, stream, isWaiting = false
}: {
  name: string; initials: string; color: string; active?: boolean; cameraOn: boolean; isLocal?: boolean; stream?: MediaStream | null; isWaiting?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current && stream && cameraOn) {
      videoRef.current.srcObject = stream
    }
  }, [stream, cameraOn])

  return (
    <div className={`relative min-h-[260px] overflow-hidden rounded-2xl border ${active ? 'border-cyan-300/50 shadow-[0_0_22px_rgba(103,232,249,.15)]' : 'border-white/10'} ${color}`}>
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
          <p className="text-xs text-slate-500">Click &apos;Invite Partner&apos; below to share link</p>
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
          {active ? <AudioLines size={14} className="text-cyan-300 animate-pulse" /> : <MicOff size={14} className="text-rose-400" />}
        </div>
      </div>
    </div>
  )
}

function Meeting({
  user, roomId, srcLang, tgtLang, guestName, onInvite, onLeave
}: {
  user: any; roomId: string; srcLang: string; tgtLang: string; guestName: string; onInvite: () => void; onLeave: () => void;
}) {
  const [mic, setMic] = useState(true)
  const [camera, setCamera] = useState(true)
  const [chat, setChat] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [originalText, setOriginalText] = useState('Listening to your speech...')
  const [translatedText, setTranslatedText] = useState('আপনার কথা অনুবাদ করার জন্য অপেক্ষা করা হচ্ছে...')
  
  const [partnerConnected, setPartnerConnected] = useState(false)
  const [partnerName, setPartnerName] = useState('Partner')

  const [chatInput, setChatInput] = useState('')
  const [messages, setMessages] = useState<Array<{ id: string; sender: string; text: string; time: string }>>([
    { id: 'initial-system-msg', sender: 'System', text: 'Encrypted meeting room established.', time: 'Now' }
  ])

  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const myDisplayName = user?.user_metadata?.full_name || guestName || 'You'
  const supabase = createClient()

  // ১. ক্যামেরা ও মাইক্রোফোন স্ট্রিম ক্যাপচার
  useEffect(() => {
    let activeStream: MediaStream | null = null
    navigator.mediaDevices?.getUserMedia({ video: true, audio: true }).then(s => {
      activeStream = s
      setLocalStream(s)
    }).catch(err => {
      console.log('Video error, trying audio only:', err)
      navigator.mediaDevices?.getUserMedia({ audio: true }).then(as => {
        activeStream = as
        setLocalStream(as)
      }).catch(e => console.log('Audio error:', e))
    })

    return () => {
      activeStream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  // ক্যামেরা এবং মাইক ট্র্যাক এনাবল/ডিজেবল
  useEffect(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach(t => { t.enabled = camera })
    }
  }, [camera, localStream])

  useEffect(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach(t => { t.enabled = mic })
    }
  }, [mic, localStream])

  // ২. Supabase Realtime Channel (রিয়েল পার্টনার সিঙ্ক ও চ্যাট)
  useEffect(() => {
    const channel = supabase.channel(`room_${roomId}`, {
      config: { broadcast: { self: false } }
    })

    channel
      .on('broadcast', { event: 'user_joined' }, ({ payload }) => {
        setPartnerConnected(true)
        setPartnerName(payload.name || 'Partner')
        channel.send({
          type: 'broadcast',
          event: 'confirm_presence',
          payload: { name: myDisplayName }
        })
      })
      .on('broadcast', { event: 'confirm_presence' }, ({ payload }) => {
        setPartnerConnected(true)
        setPartnerName(payload.name || 'Partner')
      })
      .on('broadcast', { event: 'new_chat' }, ({ payload }) => {
        setMessages(prev => [...prev, payload.message])
      })
      .on('broadcast', { event: 'new_translation' }, ({ payload }) => {
        setOriginalText(payload.original)
        setTranslatedText(payload.translated)
        if (payload.audio) {
          const audio = new Audio(`data:audio/wav;base64,${payload.audio}`)
          audio.play().catch(() => {})
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.send({
            type: 'broadcast',
            event: 'user_joined',
            payload: { name: myDisplayName }
          })
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [roomId, myDisplayName, supabase])

  // ৩. ফিক্সড অডিও রেকর্ডার (NotSupportedError সম্পূর্ণ সমাধান)
  useEffect(() => {
    if (!mic || !localStream) return
    let recorder: MediaRecorder | null = null
    let chunks: Blob[] = []

    try {
      const audioTracks = localStream.getAudioTracks()
      if (audioTracks.length === 0) return

      // কেবল অডিও ট্র্যাক দিয়ে আলাদা স্ট্রিম তৈরি যাতে ব্রাউজার ক্র্যাশ না করে
      const pureAudioStream = new MediaStream(audioTracks)

      recorder = new MediaRecorder(pureAudioStream, { mimeType: 'audio/webm' })
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = async () => {
        if (chunks.length === 0) return
        const blob = new Blob(chunks, { type: 'audio/webm' })
        chunks = []

        const reader = new FileReader()
        reader.readAsDataURL(blob)
        reader.onloadend = async () => {
          const base64Audio = (reader.result as string)?.split(',')[1]
          if (!base64Audio) return

          setTranslating(true)
          try {
            const shortTgt = tgtLang.split('-')[0]
            const azureVoice = getVoiceName(tgtLang, 'female')

            const res = await fetch('/api/transvoice/translate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                audio: base64Audio,
                tgt_lang: shortTgt,
                azure_voice: azureVoice,
                userId: user?.id,
                audioDurationSeconds: 3.0
              })
            })

            const data = await res.json()
            if (data.original_text && data.translated_text) {
              setOriginalText(data.original_text)
              setTranslatedText(data.translated_text)

              // পার্টনারের কাছে অনুবাদ ব্রডকাস্ট
              const channel = supabase.channel(`room_${roomId}`)
              channel.send({
                type: 'broadcast',
                event: 'new_translation',
                payload: {
                  original: data.original_text,
                  translated: data.translated_text,
                  audio: data.tts_audio
                }
              })

              if (data.tts_audio) {
                const audio = new Audio(`data:audio/wav;base64,${data.tts_audio}`)
                audio.play().catch(() => {})
              }
            }
          } catch (e) {
            console.error('Translation error:', e)
          } finally {
            setTranslating(false)
          }
        }
      }

      recorder.start()
      const interval = setInterval(() => {
        if (recorder && recorder.state === 'recording') {
          recorder.stop()
          recorder.start()
        }
      }, 3500)

      return () => {
        clearInterval(interval)
        if (recorder && recorder.state !== 'inactive') recorder.stop()
      }
    } catch (e) {
      console.log('Recorder init error:', e)
    }
  }, [mic, localStream, tgtLang, user, roomId, supabase])

  // ৪. চ্যাট মেসেজ পাঠানোর ফাংশন (অনন্য আইডি সহ)
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim()) return

    const newMsg = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      sender: myDisplayName,
      text: chatInput,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    setMessages(prev => [...prev, newMsg])

    // Supabase Realtime দিয়ে মেসেজ পাঠানো
    const channel = supabase.channel(`room_${roomId}`)
    await channel.send({
      type: 'broadcast',
      event: 'new_chat',
      payload: { message: newMsg }
    })

    setChatInput('')
  }

  return (
    <main className="flex min-h-screen flex-col bg-[#0b0e16] text-slate-100">
      <header className="flex h-[70px] items-center justify-between border-b border-white/[.08] px-5 lg:px-8">
        <div className="flex items-center gap-4">
          <Logo />
          <span className="hidden h-5 w-px bg-white/10 sm:block" />
          <span className="hidden text-sm font-medium text-slate-200 sm:block">Room: {roomId}</span>
          <span className="flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-[11px] text-emerald-200">
            <LockKeyhole size={12} /> Encrypted Session
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${partnerConnected ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300'}`}>
            <span className={`size-2 rounded-full ${partnerConnected ? 'bg-emerald-400' : 'bg-amber-400 animate-ping'}`} />
            {partnerConnected ? `Connected with ${partnerName}` : 'Waiting for partner...'}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-w-0 flex-1 flex-col p-4 lg:p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.2em] text-slate-600">LIVE SESSION</p>
              <h1 className="mt-1 text-lg font-semibold text-white">TransVoice Meeting</h1>
            </div>
            <span className="flex items-center gap-2 text-xs text-slate-400">
              <Users size={14} /> {partnerConnected ? '2 People' : '1 Person'}
            </span>
          </div>

          <div className="grid flex-1 gap-4 md:grid-cols-2">
            <VideoTile
              name={partnerConnected ? partnerName : 'Waiting for partner...'}
              initials={partnerName.slice(0, 2).toUpperCase()}
              color="bg-teal-900/60"
              active={partnerConnected}
              cameraOn={partnerConnected}
              isWaiting={!partnerConnected}
            />

            <VideoTile
              name={`${myDisplayName} (You)`}
              initials="You"
              color="bg-indigo-900/60"
              active={mic}
              cameraOn={camera}
              isLocal={true}
              stream={localStream}
            />
          </div>

          <div className="relative mt-4 rounded-2xl border border-cyan-300/20 bg-[#151d2c] p-4">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
              <Sparkles size={13} /> {translating ? 'Translating live...' : 'Live translation'}
            </div>
            <p className="mt-2 text-sm text-slate-400">{originalText}</p>
            <p className="mt-1 text-base font-medium text-white">{translatedText}</p>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 border-t border-white/[.08] pt-4">
            <button
              onClick={() => setMic(!mic)}
              className={`flex size-11 items-center justify-center rounded-xl border transition ${mic ? 'border-cyan-300/40 bg-cyan-300/15 text-cyan-200' : 'border-rose-500/40 bg-rose-500/15 text-rose-300'}`}
              title={mic ? 'Mute Mic' : 'Unmute Mic'}
            >
              {mic ? <Mic size={18} /> : <MicOff size={18} />}
            </button>

            <button
              onClick={() => setCamera(!camera)}
              className={`flex size-11 items-center justify-center rounded-xl border transition ${camera ? 'border-cyan-300/40 bg-cyan-300/15 text-cyan-200' : 'border-rose-500/40 bg-rose-500/15 text-rose-300'}`}
              title={camera ? 'Turn off camera' : 'Turn on camera'}
            >
              {camera ? <Camera size={18} /> : <CameraOff size={18} />}
            </button>

            <Button variant="outline" onClick={onInvite}>
              <Users size={15} /> Invite Partner
            </Button>

            <Button variant="outline" onClick={() => setChat(!chat)} className="relative">
              <MessageCircle size={15} /> Chat
              {messages.length > 1 && (
                <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-cyan-400 text-[10px] font-bold text-slate-950">
                  {messages.length - 1}
                </span>
              )}
            </Button>

            <Button variant="danger" onClick={onLeave}>
              <PhoneOff size={15} /> Leave
            </Button>
          </div>
        </section>

        {chat && (
          <aside className="flex flex-col w-full border-l border-white/[.08] bg-[#10131d] p-5 lg:w-[340px]">
            <div className="flex justify-between items-center pb-4 border-b border-white/[.08]">
              <div>
                <h2 className="font-semibold text-white text-sm">Meeting Chat</h2>
                <p className="text-[11px] text-slate-500">{partnerConnected ? '2 participants' : 'Only you'}</p>
              </div>
              <button onClick={() => setChat(false)} className="text-slate-400 hover:text-white"><X size={18} /></button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-3">
              {messages.map(m => (
                <div key={m.id} className="rounded-xl border border-white/5 bg-white/[.02] p-3 text-xs">
                  <div className="flex justify-between text-slate-500 mb-1">
                    <span className={`font-semibold ${m.sender === myDisplayName ? 'text-cyan-300' : 'text-indigo-300'}`}>{m.sender}</span>
                    <span>{m.time}</span>
                  </div>
                  <p className="text-slate-200">{m.text}</p>
                </div>
              ))}
            </div>

            <form onSubmit={handleSendMessage} className="pt-3 border-t border-white/[.08] flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                placeholder="Message everyone..."
                className="flex-1 rounded-xl border border-white/10 bg-white/[.04] px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-cyan-300"
              />
              <Button className="px-3 py-2">
                <Send size={14} />
              </Button>
            </form>
          </aside>
        )}
      </div>
    </main>
  )
}

function Dashboard({
  user, balance, onMeeting, onInvite, onAuth, onPricing, onJoin, onSignOut
}: {
  user: any; balance: number; onMeeting: () => void; onInvite: () => void; onAuth: () => void; onPricing: () => void; onJoin: () => void; onSignOut: () => void;
}) {
  return (
    <main className="min-h-screen bg-[#0b0e16] text-slate-100">
      <header className="flex h-[74px] items-center justify-between border-b border-white/[.08] px-5 lg:px-10">
        <Logo />
        <div className="flex items-center gap-3">
          <button onClick={onPricing} className="text-xs text-slate-400 hover:text-white">
            <span className="font-semibold text-cyan-300">{balance.toFixed(0)} min</span> remaining
          </button>
          {user ? (
            <Button variant="outline" onClick={onSignOut}><LogOut size={14} />Sign out</Button>
          ) : (
            <Button variant="outline" onClick={onAuth}>Sign in</Button>
          )}
          <Button onClick={onMeeting}><Plus size={16} />New meeting</Button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-10 lg:px-10">
        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <p className="font-mono text-xs uppercase tracking-[.2em] text-cyan-300">Your workspace</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
              {user ? `Welcome back, ${user.user_metadata?.full_name || user.email?.split('@')[0]}` : 'Good morning, Guest'}
            </h1>
            <p className="mt-2 text-sm text-slate-500">Start a translated conversation across 140+ languages.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onJoin}><Link2 size={15} />Join with link</Button>
            <Button onClick={onMeeting}><Video size={15} />Start meeting</Button>
          </div>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
            <p className="text-xs text-slate-500">Translation minutes</p>
            <div className="mt-3 flex items-end justify-between">
              <p className="text-3xl font-semibold text-white">{balance.toFixed(0)}<span className="text-sm font-normal text-slate-500"> mins</span></p>
              <Zap className="text-cyan-300" size={20} />
            </div>
            <div className="mt-4 h-1.5 rounded-full bg-slate-800">
              <div className="h-full bg-cyan-300" style={{ width: `${Math.min(100, (balance / 100) * 100)}%` }} />
            </div>
            <button onClick={onPricing} className="mt-3 text-xs font-medium text-cyan-300">View plans →</button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
            <p className="text-xs text-slate-500">Inference Latency</p>
            <p className="mt-3 text-3xl font-semibold text-white">~650ms</p>
            <p className="mt-3 text-xs text-emerald-300">Triton Azure T4 GPU Active</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
            <p className="text-xs text-slate-500">Supported Languages</p>
            <p className="mt-3 text-3xl font-semibold text-white">140+</p>
            <p className="mt-3 text-xs text-slate-500">Neural Voice Dubbing enabled</p>
          </div>
        </div>
      </div>
    </main>
  )
}

export default function Home() {
  const [screen, setScreen] = useState<'dashboard' | 'meeting' | 'join'>('dashboard')
  const [modal, setModal] = useState<'invite' | 'auth' | 'pricing' | null>(null)
  const [roomId, setRoomId] = useState('room-jbv6k9')
  const [srcLang, setSrcLang] = useState('en-US')
  const [tgtLang, setTgtLang] = useState('bn-BD')
  const [guestName, setGuestName] = useState('Guest Partner')
  const [user, setUser] = useState<any>(null)
  const [balance, setBalance] = useState<number>(15)

  const supabase = createClient()

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const r = params.get('room')
      const v = params.get('view')
      if (r) setRoomId(r)
      if (v === 'join') setScreen('join')
    }
  }, [])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setUser(data.user)
        supabase.from('profiles').select('minutes_balance').eq('id', data.user.id).maybeSingle().then(({ data: p }) => {
          if (p?.minutes_balance !== undefined) setBalance(Number(p.minutes_balance))
        })
      }
    })
  }, [supabase])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setBalance(15)
    window.location.reload()
  }

  const startMeeting = () => {
    const randomId = `room-${Math.random().toString(36).substring(2, 8)}`
    setRoomId(randomId)
    setScreen('meeting')
  }

  if (screen === 'join') {
    return (
      <JoinScreen
        onJoin={() => setScreen('meeting')}
        srcLang={srcLang}
        setSrcLang={setSrcLang}
        tgtLang={tgtLang}
        setTgtLang={setTgtLang}
        guestName={guestName}
        setGuestName={setGuestName}
      />
    )
  }

  if (screen === 'meeting') {
    return (
      <>
        <Meeting
          user={user}
          roomId={roomId}
          srcLang={srcLang}
          tgtLang={tgtLang}
          guestName={guestName}
          onInvite={() => setModal('invite')}
          onLeave={() => setScreen('dashboard')}
        />
        {modal === 'invite' && <InviteModal roomId={roomId} onClose={() => setModal(null)} />}
      </>
    )
  }

  return (
    <>
      <Dashboard
        user={user}
        balance={balance}
        onMeeting={startMeeting}
        onJoin={() => setScreen('join')}
        onInvite={() => setModal('invite')}
        onAuth={() => setModal('auth')}
        onPricing={() => setModal('pricing')}
        onSignOut={handleSignOut}
      />
      {modal === 'invite' && <InviteModal roomId={roomId} onClose={() => setModal(null)} />}
      {modal === 'auth' && <AuthModal onClose={() => setModal(null)} />}
      {modal === 'pricing' && <PricingModal user={user} balance={balance} onClose={() => setModal(null)} />}
    </>
  )
}