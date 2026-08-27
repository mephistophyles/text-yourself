import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

let uuidCounter = 0
Object.defineProperty(globalThis, 'crypto', {
  value: { ...globalThis.crypto, randomUUID: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}` },
  configurable: true
})

Object.defineProperty(globalThis, 'scrollTo', { value: () => undefined, configurable: true })
Element.prototype.scrollIntoView = () => undefined

afterEach(cleanup)
