import { setupServer } from 'msw/node'
import { transvoiceHandlers } from './transvoice'

export const server = setupServer(...transvoiceHandlers)
