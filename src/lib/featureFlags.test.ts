// The `./env` module is parsed once at import, so tests control the
// `NEXT_PUBLIC_*` values through this mutable object and re-import
// `./featureFlags` after `jest.resetModules()`. `ENABLE_*` values are read
// live from `process.env` on every call.
type MockEnv = {
  NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS: boolean
  NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT: boolean
  NEXT_PUBLIC_ENABLE_RECEIPT_ITEMS: boolean
  NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT: boolean
  S3_PUBLIC_URL: string | null
}

const mockEnv: MockEnv = {
  NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS: false,
  NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT: false,
  NEXT_PUBLIC_ENABLE_RECEIPT_ITEMS: false,
  NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT: false,
  S3_PUBLIC_URL: null,
}

jest.mock('./env', () => ({ env: mockEnv }))

const ENV_KEYS = [
  'ENABLE_EXPENSE_DOCUMENTS',
  'ENABLE_RECEIPT_EXTRACT',
  'ENABLE_RECEIPT_ITEMS',
  'ENABLE_CATEGORY_EXTRACT',
] as const

async function loadFlags() {
  jest.resetModules()
  const { getRuntimeFeatureFlags } = await import('./featureFlags')
  return getRuntimeFeatureFlags()
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key]
  Object.assign(mockEnv, {
    NEXT_PUBLIC_ENABLE_EXPENSE_DOCUMENTS: false,
    NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT: false,
    NEXT_PUBLIC_ENABLE_RECEIPT_ITEMS: false,
    NEXT_PUBLIC_ENABLE_CATEGORY_EXTRACT: false,
    S3_PUBLIC_URL: null,
  } satisfies MockEnv)
})

describe('getRuntimeFeatureFlags', () => {
  it('reports every flag as off by default', async () => {
    const flags = await loadFlags()

    expect(flags.enableReceiptItems).toBe(false)
    expect(flags.enableReceiptExtract).toBe(false)
    expect(flags.enableExpenseDocuments).toBe(false)
    expect(flags.enableCategoryExtract).toBe(false)
  })

  it('enables items and implies extraction from ENABLE_RECEIPT_ITEMS', async () => {
    process.env.ENABLE_RECEIPT_ITEMS = 'true'

    const flags = await loadFlags()

    expect(flags.enableReceiptItems).toBe(true)
    expect(flags.enableReceiptExtract).toBe(true)
  })

  it('enables items and implies extraction from NEXT_PUBLIC_ENABLE_RECEIPT_ITEMS', async () => {
    mockEnv.NEXT_PUBLIC_ENABLE_RECEIPT_ITEMS = true

    const flags = await loadFlags()

    expect(flags.enableReceiptItems).toBe(true)
    expect(flags.enableReceiptExtract).toBe(true)
  })

  it('does not turn on unrelated flags when items is enabled', async () => {
    process.env.ENABLE_RECEIPT_ITEMS = 'true'

    const flags = await loadFlags()

    expect(flags.enableExpenseDocuments).toBe(false)
    expect(flags.enableCategoryExtract).toBe(false)
    expect(flags.s3PublicUrl).toBeNull()
  })
})
