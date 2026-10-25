// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
const back = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, back }), redirect: vi.fn() }))
vi.mock('@/app/m/actions', () => ({ joinFromLobby: vi.fn(async () => ({})) }))
const saved = { audio: vi.fn(), video: vi.fn() }
vi.mock('@livekit/components-react', () => ({
  usePersistentUserChoices: () => ({
    userChoices: { audioDeviceId: '', videoDeviceId: '' },
    saveAudioInputEnabled: saved.audio,
    saveVideoInputEnabled: saved.video,
    saveAudioInputDeviceId: vi.fn(),
    saveVideoInputDeviceId: vi.fn(),
  }),
  useMediaDevices: ({ kind }: { kind: string }) =>
    kind === 'audioinput'
      ? [
          { deviceId: 'mic-1', label: 'Built-in mic' },
          { deviceId: 'mic-2', label: 'Headset' },
        ]
      : [],
}))

const { Lobby } = await import('@/components/meeting/lobby')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const lobby = (role: 'host' | 'guest') =>
  render(
    <Lobby
      meetingId="11111111-1111-4111-8111-111111111111"
      role={role}
      defaultName="Atik Islam"
      spokenLang="bn-BD"
      listenLang="en-US"
    />,
  )

describe('Lobby', () => {
  it('lets you pick the microphone and remembers mute choices for the room', () => {
    lobby('host')
    expect(screen.getByRole('combobox', { name: 'Microphone' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Camera' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Microphone on' }))
    expect(saved.audio).toHaveBeenCalledWith(false)
    expect(screen.getByDisplayValue('off', { exact: true })).toHaveAttribute('name', 'mic')
  })

  it('host: "Start Translated Meeting"', () => {
    lobby('host')
    expect(screen.getByRole('heading', { name: 'Start Translated Meeting' })).toBeInTheDocument()
  })

  it('guest: "You\'re invited — Join Translated Meeting"', () => {
    lobby('guest')
    expect(
      screen.getByRole('heading', { name: "You're invited — Join Translated Meeting" }),
    ).toBeInTheDocument()
  })

  it('prefills name and languages from the profile; "I speak" lists only spoken languages', () => {
    lobby('guest')
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveValue('Atik Islam')
    const speak = screen.getByRole('combobox', { name: 'I speak' }) as HTMLSelectElement
    const hear = screen.getByRole('combobox', { name: 'I want to hear' }) as HTMLSelectElement
    expect(speak.value).toBe('bn-BD')
    expect(hear.value).toBe('en-US')
    expect(speak.options.length).toBeLessThan(hear.options.length)
    expect([...speak.options].some((o) => o.value === 'zu-ZA')).toBe(false)
    expect(screen.queryByDisplayValue('Guest Partner')).toBeNull()
  })

  it('has a keyboard-accessible Back button that falls back to /dashboard', () => {
    lobby('host')
    const backButton = screen.getByRole('button', { name: 'Back' })
    backButton.focus()
    expect(backButton).toHaveFocus()
    fireEvent.click(backButton)
    expect(push).toHaveBeenCalledWith('/dashboard')
  })
})
