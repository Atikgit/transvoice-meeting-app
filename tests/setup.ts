import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { TEST_ENV } from './mocks/env'
import { server } from './mocks/server'

Object.assign(process.env, TEST_ENV)

// Any request without a handler fails the test, so real services are never called.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
