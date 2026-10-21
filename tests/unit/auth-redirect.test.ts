import { describe, expect, it } from 'vitest'
import { safeNextPath, withNext } from '@/lib/auth/redirect'

describe('safeNextPath', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/invite/abc?x=1#top', '/invite/abc?x=1#top'],
    ['/m/123/lobby', '/m/123/lobby'],
  ])('keeps same-origin path %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected)
  })

  it.each([
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    'javascript:alert(1)',
    'dashboard',
    '',
    '/\u0000evil',
    '/\tevil',
  ])('rejects %j', (input) => {
    expect(safeNextPath(input)).toBe('/dashboard')
  })

  it('rejects non-strings and uses the given fallback', () => {
    expect(safeNextPath(undefined)).toBe('/dashboard')
    expect(safeNextPath(['/a'], '/')).toBe('/')
  })
})

describe('withNext', () => {
  it('appends an encoded next path', () => {
    expect(withNext('/signup', '/invite/abc?x=1')).toBe('/signup?next=%2Finvite%2Fabc%3Fx%3D1')
  })

  it('drops unsafe next values', () => {
    expect(withNext('/login', '//evil.com')).toBe('/login')
  })
})
