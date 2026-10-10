// See the note in src/components/expense-form-actions.test.ts on why this is a
// `var` reached through an arrow.
var mockCreate = jest.fn()
var mockGetRuntimeFeatureFlags = jest.fn(async () => ({
  enableReceiptExtract: true,
  enableReceiptItems: true,
}))
var mockGetReceiptByImage = jest.fn()
var mockCreatePendingReceipt = jest.fn()
var mockCompleteReceipt = jest.fn()
var mockFailReceipt = jest.fn()
var mockClaimReceiptForExtraction = jest.fn()

jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    chat = {
      completions: { create: (...args: unknown[]) => mockCreate(...args) },
    }
  },
}))
jest.mock('../../../../lib/env', () => ({
  env: {
    OPENAI_API_KEY: 'sk-test',
    OPENAI_BASE_URL: undefined,
    OPENAI_MODEL_RECEIPT_EXTRACT: 'test-vision-model',
    OPENAI_MODEL_RECEIPT_ITEMS_EXTRACT: undefined,
  },
}))
jest.mock('../../../../lib/featureFlags', () => ({
  getRuntimeFeatureFlags: () => mockGetRuntimeFeatureFlags(),
}))
jest.mock('../../../../lib/api', () => ({
  getCategories: async () => [
    { id: 0, grouping: 'General', name: 'General' },
    { id: 4, grouping: 'Transport', name: 'Taxi' },
  ],
  getGroup: async () => ({
    currencyCode: 'USD',
    currency: '$',
    participants: [],
  }),
}))
jest.mock('../../../../lib/uploaded-image-url', () => ({
  isAllowedUploadUrl: (url: string) => url.startsWith('https://uploads.test/'),
}))
jest.mock('../../../../lib/receipts', () => ({
  getReceiptByImage: (...args: unknown[]) => mockGetReceiptByImage(...args),
  createPendingReceipt: (...args: unknown[]) =>
    mockCreatePendingReceipt(...args),
  completeReceipt: (...args: unknown[]) => mockCompleteReceipt(...args),
  failReceipt: (...args: unknown[]) => mockFailReceipt(...args),
  claimReceiptForExtraction: (...args: unknown[]) =>
    mockClaimReceiptForExtraction(...args),
}))

import { env } from '../../../../lib/env'
import {
  extractExpenseInformationFromImage,
  extractReceiptItemsForImage,
} from './create-from-receipt-button-actions'

const IMAGE = 'https://uploads.test/receipt.jpg'

const ENABLED_FLAGS = {
  enableReceiptExtract: true,
  enableReceiptItems: true,
}

const PENDING_RECEIPT_ID = 'receipt-pending'

const VALID_ITEMS_EXTRACTION = {
  merchant: 'Pizza Place',
  date: '2026-03-01',
  currencyCode: 'usd',
  total: 25,
  categoryId: '4',
  items: [{ name: 'Pizza', quantity: 2, unitPrice: 10, amount: 20 }],
  charges: [{ name: 'Tax', amount: 5 }],
}

function respondWith(content: string | null) {
  mockCreate.mockResolvedValue({ choices: [{ message: { content } }] })
}

const NOTHING_EXTRACTED = {
  amount: null,
  categoryId: null,
  date: null,
  title: null,
}

describe('extractExpenseInformationFromImage', () => {
  beforeEach(() => mockCreate.mockReset())

  it('returns every field the model read off the receipt', async () => {
    respondWith(
      JSON.stringify({
        amount: 42.5,
        categoryId: '4',
        date: '2026-03-01',
        title: 'Dinner',
      }),
    )
    expect(await extractExpenseInformationFromImage(IMAGE)).toEqual({
      amount: 42.5,
      categoryId: '4',
      date: '2026-03-01',
      title: 'Dinner',
    })
  })

  it('keeps a title containing a comma intact', async () => {
    respondWith(
      JSON.stringify({
        amount: 42.5,
        categoryId: '4',
        date: '2026-03-01',
        title: 'Dinner, drinks and tip',
      }),
    )
    const info = await extractExpenseInformationFromImage(IMAGE)
    expect(info.title).toBe('Dinner, drinks and tip')
    expect(info.amount).toBe(42.5)
  })

  it('asks for a strict JSON schema, and for the configured model', async () => {
    respondWith(
      JSON.stringify({
        amount: 1,
        categoryId: '0',
        date: '2026-03-01',
        title: 'x',
      }),
    )
    await extractExpenseInformationFromImage(IMAGE)

    const request = mockCreate.mock.calls[0][0]
    expect(request.model).toBe('test-vision-model')
    expect(request.response_format.type).toBe('json_schema')
    expect(request.response_format.json_schema.strict).toBe(true)
  })

  it.each([
    [
      'a field of the wrong type',
      JSON.stringify({
        amount: '42.5',
        categoryId: '4',
        date: '2026-03-01',
        title: 'x',
      }),
    ],
    ['a missing field', JSON.stringify({ amount: 42.5, categoryId: '4' })],
    ['a response that is not JSON', '42.5,4,2026-03-01,Dinner'],
    ['an empty response', ''],
  ])('reports nothing extracted for %s', async (_name, content) => {
    respondWith(content)
    expect(await extractExpenseInformationFromImage(IMAGE)).toEqual(
      NOTHING_EXTRACTED,
    )
  })

  it('reports nothing extracted when there is no content at all', async () => {
    respondWith(null)
    expect(await extractExpenseInformationFromImage(IMAGE)).toEqual(
      NOTHING_EXTRACTED,
    )
  })

  it('refuses an image URL the app did not upload', async () => {
    respondWith(JSON.stringify({ amount: 1 }))
    await expect(
      extractExpenseInformationFromImage('https://evil.example/receipt.jpg'),
    ).rejects.toThrow('Invalid image URL.')
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe('extractReceiptItemsForImage', () => {
  beforeEach(() => {
    mockCreate.mockReset()
    mockGetRuntimeFeatureFlags.mockReset().mockResolvedValue(ENABLED_FLAGS)
    mockGetReceiptByImage.mockReset().mockResolvedValue(null)
    mockCreatePendingReceipt
      .mockReset()
      .mockResolvedValue({ id: PENDING_RECEIPT_ID })
    mockCompleteReceipt
      .mockReset()
      .mockImplementation(async (receiptId, data) => ({
        id: receiptId,
        status: 'EXTRACTED',
        total: data.normalized.total ?? data.normalized.itemsTotal,
        merchant: data.normalized.merchant,
        receiptDate: null,
        currencyCode: data.normalized.currencyCode,
        items: [],
      }))
    mockFailReceipt.mockReset().mockResolvedValue(undefined)
    mockClaimReceiptForExtraction.mockReset().mockResolvedValue(true)
    env.OPENAI_MODEL_RECEIPT_ITEMS_EXTRACT = undefined
  })

  it('extracts items and whole-bill charges, persisting them in minor units', async () => {
    respondWith(JSON.stringify(VALID_ITEMS_EXTRACTION))

    const result = await extractReceiptItemsForImage({
      groupId: 'group-1',
      imageUrl: IMAGE,
      imageWidth: 800,
      imageHeight: 1200,
    })

    expect(result).toEqual({
      status: 'EXTRACTED',
      receiptId: PENDING_RECEIPT_ID,
      total: 2500,
      itemsTotal: 2500,
      merchant: 'Pizza Place',
      date: '2026-03-01',
      currencyCode: 'USD',
      categoryId: '4',
    })

    // Exactly one model call, with the strict JSON schema.
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const request = mockCreate.mock.calls[0][0]
    expect(request.model).toBe('test-vision-model')
    expect(request.response_format.type).toBe('json_schema')
    expect(request.response_format.json_schema.name).toBe(
      'receipt_items_response',
    )
    expect(request.response_format.json_schema.strict).toBe(true)

    // Items stay unassigned; charges are marked shared.
    expect(mockCompleteReceipt).toHaveBeenCalledTimes(1)
    const [receiptId, data] = mockCompleteReceipt.mock.calls[0]
    expect(receiptId).toBe(PENDING_RECEIPT_ID)
    expect(data.normalized.items).toEqual([
      {
        name: 'Pizza',
        quantityMilli: 2000,
        unitPrice: 1000,
        amount: 2000,
        isShared: false,
        isAdjustment: false,
        position: 0,
      },
      {
        name: 'Tax',
        quantityMilli: 1000,
        unitPrice: null,
        amount: 500,
        isShared: true,
        isAdjustment: false,
        position: 1,
      },
    ])
  })

  it('claims the extraction before calling the model', async () => {
    respondWith(JSON.stringify(VALID_ITEMS_EXTRACTION))

    await extractReceiptItemsForImage({ groupId: 'group-1', imageUrl: IMAGE })

    expect(mockClaimReceiptForExtraction).toHaveBeenCalledWith(
      PENDING_RECEIPT_ID,
    )
    expect(
      mockClaimReceiptForExtraction.mock.invocationCallOrder[0],
    ).toBeLessThan(mockCreate.mock.invocationCallOrder[0])
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('refuses to call the model when another extraction holds the claim', async () => {
    mockClaimReceiptForExtraction.mockResolvedValue(false)
    respondWith(JSON.stringify(VALID_ITEMS_EXTRACTION))

    await expect(
      extractReceiptItemsForImage({ groupId: 'group-1', imageUrl: IMAGE }),
    ).rejects.toThrow('Receipt extraction is already in progress.')

    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockCompleteReceipt).not.toHaveBeenCalled()
    expect(mockFailReceipt).not.toHaveBeenCalled()
  })

  it('reuses an existing EXTRACTED receipt without calling the model', async () => {
    mockGetReceiptByImage.mockResolvedValue({
      id: 'receipt-existing',
      status: 'EXTRACTED',
      rawExtraction: JSON.stringify(VALID_ITEMS_EXTRACTION),
      total: 2500,
      merchant: 'Pizza Place',
      receiptDate: new Date('2026-03-01T12:00:00.000Z'),
      currencyCode: 'USD',
      items: [{ amount: 2000 }, { amount: 500 }],
    })

    const result = await extractReceiptItemsForImage({
      groupId: 'group-1',
      imageUrl: IMAGE,
    })

    expect(result).toEqual({
      status: 'EXTRACTED',
      receiptId: 'receipt-existing',
      total: 2500,
      itemsTotal: 2500,
      merchant: 'Pizza Place',
      date: '2026-03-01',
      currencyCode: 'USD',
      categoryId: '4',
    })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockCompleteReceipt).not.toHaveBeenCalled()
    expect(mockCreatePendingReceipt).not.toHaveBeenCalled()
  })

  it('records a failure and returns FAILED for malformed model output', async () => {
    respondWith('this is not json')

    const result = await extractReceiptItemsForImage({
      groupId: 'group-1',
      imageUrl: IMAGE,
    })

    expect(result).toEqual({
      status: 'FAILED',
      receiptId: PENDING_RECEIPT_ID,
    })
    expect(mockFailReceipt).toHaveBeenCalledWith(PENDING_RECEIPT_ID, {
      rawExtraction: 'this is not json',
      provider: 'openai',
      model: 'test-vision-model',
    })
    expect(mockCompleteReceipt).not.toHaveBeenCalled()
  })

  it('records a failure and returns FAILED when the model call throws', async () => {
    mockCreate.mockRejectedValue(new Error('upstream 500'))

    const result = await extractReceiptItemsForImage({
      groupId: 'group-1',
      imageUrl: IMAGE,
    })

    expect(result).toEqual({
      status: 'FAILED',
      receiptId: PENDING_RECEIPT_ID,
    })
    expect(mockFailReceipt).toHaveBeenCalledWith(PENDING_RECEIPT_ID, {
      rawExtraction: null,
      provider: 'openai',
      model: 'test-vision-model',
    })
    expect(mockCompleteReceipt).not.toHaveBeenCalled()
  })

  it('rejects when the items feature flag is off, before any AI call', async () => {
    mockGetRuntimeFeatureFlags.mockResolvedValue({
      enableReceiptExtract: true,
      enableReceiptItems: false,
    })

    await expect(
      extractReceiptItemsForImage({ groupId: 'group-1', imageUrl: IMAGE }),
    ).rejects.toThrow('Receipt items extraction is not enabled.')
    expect(mockGetReceiptByImage).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('rejects a non-app image URL before calling the model', async () => {
    await expect(
      extractReceiptItemsForImage({
        groupId: 'group-1',
        imageUrl: 'https://evil.example/receipt.jpg',
      }),
    ).rejects.toThrow('Invalid image URL.')
    expect(mockGetReceiptByImage).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('uses the items model when set and falls back to the extraction model otherwise', async () => {
    respondWith(JSON.stringify(VALID_ITEMS_EXTRACTION))
    env.OPENAI_MODEL_RECEIPT_ITEMS_EXTRACT = 'test-items-model'
    await extractReceiptItemsForImage({
      groupId: 'group-1',
      imageUrl: IMAGE,
    })
    expect(mockCreate.mock.calls[0][0].model).toBe('test-items-model')

    mockCreate.mockClear()
    respondWith(JSON.stringify(VALID_ITEMS_EXTRACTION))
    env.OPENAI_MODEL_RECEIPT_ITEMS_EXTRACT = undefined
    await extractReceiptItemsForImage({
      groupId: 'group-1',
      imageUrl: IMAGE,
    })
    expect(mockCreate.mock.calls[0][0].model).toBe('test-vision-model')
  })
})
