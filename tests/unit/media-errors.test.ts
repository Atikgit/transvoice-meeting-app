import { describe, expect, it } from 'vitest'
import { describeMediaProblem, deviceFromKind } from '@/lib/meetings/media-errors'

const domError = (name: string) => Object.assign(new Error(name), { name })

describe('describeMediaProblem', () => {
  it.each(['NotAllowedError', 'PermissionDenied', 'SecurityError'])('%s → permission', (name) => {
    const problem = describeMediaProblem(domError(name), 'microphone')
    expect(problem).toMatchObject({ kind: 'permission', recovery: 'reload' })
    expect(problem.message).toMatch(/lock icon/)
    expect(problem.message).toMatch(/Settings → Safari/)
  })

  it.each(['NotReadableError', 'DeviceInUse', 'TrackStartError'])('%s → in use', (name) => {
    const problem = describeMediaProblem(
      name === 'DeviceInUse' ? name : domError(name),
      'microphone',
    )
    expect(problem).toMatchObject({ kind: 'in_use', recovery: 'retry' })
    expect(problem.message).toMatch(/another app/)
  })

  it.each(['NotFoundError', 'NotFound', 'OverconstrainedError'])('%s → not found', (name) => {
    expect(describeMediaProblem(domError(name), 'camera')).toMatchObject({
      kind: 'not_found',
      message: expect.stringMatching(/No camera found/),
    })
  })

  it('anything else is a generic, retryable problem', () => {
    expect(describeMediaProblem(new Error('boom'), 'camera')).toMatchObject({
      kind: 'other',
      recovery: 'retry',
    })
    expect(describeMediaProblem(undefined, 'microphone').kind).toBe('other')
  })

  it('names the device', () => {
    expect(deviceFromKind('videoinput')).toBe('camera')
    expect(deviceFromKind('audioinput')).toBe('microphone')
  })
})
