// `env` parses `process.env` once at import, so each case mutates
// `process.env`, resets the module registry and re-imports the module
// dynamically. A snapshot of the environment is restored afterwards.
const RELEVANT_KEYS = [
  'ENABLE_EXPENSE_DOCUMENTS',
  'NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS',
  'ENABLE_RECEIPT_EXTRACT',
  'NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT',
  'ENABLE_RECEIPT_ITEMS',
  'NEXT_PUBLIC_ENABLE_RECEIPT_ITEMS',
  'ENABLE_CATEGORY_EXTRACT',
  'NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT',
  'AI_API_KEY',
  'OPENAI_API_KEY',
  'AI_MODEL_RECEIPT_ITEMS_EXTRACT',
  'OPENAI_MODEL_RECEIPT_ITEMS_EXTRACT',
] as const

let originalEnv: NodeJS.ProcessEnv

beforeEach(() => {
  originalEnv = { ...process.env }
  for (const key of RELEVANT_KEYS) delete process.env[key]
})

afterEach(() => {
  process.env = originalEnv
})

async function importEnv() {
  jest.resetModules()
  return import('./env')
}

describe('env receipt-items configuration', () => {
  it('rejects ENABLE_RECEIPT_ITEMS without OPENAI_API_KEY', async () => {
    process.env.ENABLE_RECEIPT_ITEMS = 'true'

    await expect(importEnv()).rejects.toThrow()
  })

  it('rejects NEXT_PUBLIC_ENABLE_RECEIPT_ITEMS without OPENAI_API_KEY', async () => {
    process.env.NEXT_PUBLIC_ENABLE_RECEIPT_ITEMS = 'true'

    await expect(importEnv()).rejects.toThrow()
  })

  it('parses when items and OPENAI_API_KEY are both set, leaving the model unset', async () => {
    process.env.ENABLE_RECEIPT_ITEMS = 'true'
    process.env.OPENAI_API_KEY = 'sk-test'

    const { env } = await importEnv()

    expect(env.ENABLE_RECEIPT_ITEMS).toBe(true)
    expect(env.OPENAI_MODEL_RECEIPT_ITEMS_EXTRACT).toBeUndefined()
  })

  it('reads OPENAI_MODEL_RECEIPT_ITEMS_EXTRACT when provided', async () => {
    process.env.ENABLE_RECEIPT_ITEMS = 'true'
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.OPENAI_MODEL_RECEIPT_ITEMS_EXTRACT = 'test-items-model'

    const { env } = await importEnv()

    expect(env.OPENAI_MODEL_RECEIPT_ITEMS_EXTRACT).toBe('test-items-model')
  })

  it('accepts AI_API_KEY as an alternative to OPENAI_API_KEY', async () => {
    process.env.ENABLE_RECEIPT_ITEMS = 'true'
    process.env.AI_API_KEY = 'gemini-key'

    const { env } = await importEnv()

    expect(env.ENABLE_RECEIPT_ITEMS).toBe(true)
    expect(env.AI_API_KEY).toBe('gemini-key')
  })

  it('reads the provider-neutral AI_MODEL_RECEIPT_ITEMS_EXTRACT', async () => {
    process.env.ENABLE_RECEIPT_ITEMS = 'true'
    process.env.AI_API_KEY = 'gemini-key'
    process.env.AI_MODEL_RECEIPT_ITEMS_EXTRACT = 'gemini-2.5-flash'

    const { env } = await importEnv()

    expect(env.AI_MODEL_RECEIPT_ITEMS_EXTRACT).toBe('gemini-2.5-flash')
  })

  it('parses without the items flags even when OPENAI_API_KEY is unset', async () => {
    const { env } = await importEnv()

    expect(env.ENABLE_RECEIPT_ITEMS).toBe(false)
    expect(env.NEXT_PUBLIC_ENABLE_RECEIPT_ITEMS).toBe(false)
  })
})
