import {
  MAX_RECEIPT_ITEMS,
  RECEIPT_ITEMS_JSON_SCHEMA,
  normalizeReceipt,
  parseReceiptItemsResponse,
  type ReceiptItemsExtraction,
} from './receipt-extraction'

const validPayload = {
  merchant: 'Café',
  date: '2026-04-01',
  currencyCode: 'eur',
  total: 42.5,
  categoryId: 7,
  items: [
    { name: 'Coffee', quantity: 2, unitPrice: 3, amount: 6 },
    { name: 'Cake', quantity: 1, unitPrice: 10, amount: 10 },
  ],
  charges: [{ name: 'Tax', amount: 4 }],
} as const

describe('parseReceiptItemsResponse', () => {
  it('returns null for null/empty/whitespace content', () => {
    expect(parseReceiptItemsResponse(null)).toBeNull()
    expect(parseReceiptItemsResponse('')).toBeNull()
    expect(parseReceiptItemsResponse('   ')).toBeNull()
  })

  it('returns null for non-JSON content', () => {
    expect(parseReceiptItemsResponse('not json')).toBeNull()
  })

  it('returns null when a field has the wrong type', () => {
    expect(
      parseReceiptItemsResponse(
        JSON.stringify({ ...validPayload, total: 'a lot' }),
      ),
    ).toBeNull()
    expect(
      parseReceiptItemsResponse(
        JSON.stringify({
          ...validPayload,
          items: [{ name: 'Coffee', quantity: 'two', amount: 6 }],
        }),
      ),
    ).toBeNull()
  })

  it('parses a valid payload', () => {
    const parsed = parseReceiptItemsResponse(JSON.stringify(validPayload))

    expect(parsed).not.toBeNull()
    expect(parsed?.merchant).toBe('Café')
    expect(parsed?.items).toHaveLength(2)
    expect(parsed?.charges).toEqual([{ name: 'Tax', amount: 4 }])
  })

  it('defaults missing items/charges to empty arrays', () => {
    const parsed = parseReceiptItemsResponse(JSON.stringify({ total: 10 }))

    expect(parsed?.items).toEqual([])
    expect(parsed?.charges).toEqual([])
  })

  it('caps items at MAX_RECEIPT_ITEMS but keeps charges as-is', () => {
    const items = Array.from({ length: MAX_RECEIPT_ITEMS + 5 }, (_, i) => ({
      name: `Item ${i}`,
      quantity: 1,
      amount: 1,
    }))
    const parsed = parseReceiptItemsResponse(
      JSON.stringify({ ...validPayload, items }),
    )

    expect(parsed?.items).toHaveLength(MAX_RECEIPT_ITEMS)
    expect(parsed?.items[0].name).toBe('Item 0')
    expect(parsed?.charges).toHaveLength(1)
  })
})

describe('normalizeReceipt', () => {
  it('converts major units to minor units (2 decimals)', () => {
    const extraction: ReceiptItemsExtraction = {
      merchant: null,
      date: null,
      currencyCode: null,
      total: 42.5,
      categoryId: null,
      items: [{ name: 'Coffee', quantity: 1, unitPrice: 42.5, amount: 42.5 }],
      charges: [],
    }

    const result = normalizeReceipt(extraction, 2)

    expect(result.total).toBe(4250)
    expect(result.items[0].amount).toBe(4250)
    expect(result.items[0].unitPrice).toBe(4250)
    expect(result.itemsTotal).toBe(4250)
  })

  it('converts major units with 0 decimals (JPY)', () => {
    const extraction: ReceiptItemsExtraction = {
      merchant: null,
      date: null,
      currencyCode: 'JPY',
      total: 1000,
      categoryId: null,
      items: [{ name: 'Ramen', quantity: 1, unitPrice: 1000, amount: 1000 }],
      charges: [],
    }

    const result = normalizeReceipt(extraction, 0)

    expect(result.items[0].amount).toBe(1000)
    expect(result.total).toBe(1000)
  })

  it('marks items as not shared and charges as shared', () => {
    const result = normalizeReceipt(
      {
        merchant: null,
        date: null,
        currencyCode: null,
        total: null,
        categoryId: null,
        items: [{ name: 'Pizza', quantity: 1, amount: 10 }],
        charges: [{ name: 'Service', amount: 2 }],
      },
      2,
    )

    const [item, charge] = result.items
    expect(item).toMatchObject({ isShared: false, isAdjustment: false })
    expect(charge).toMatchObject({ isShared: true, isAdjustment: false })
  })

  it('assigns sequential positions items-then-charges', () => {
    const result = normalizeReceipt(
      {
        merchant: null,
        date: null,
        currencyCode: null,
        total: null,
        categoryId: null,
        items: [
          { name: 'A', quantity: 1, amount: 1 },
          { name: 'B', quantity: 1, amount: 1 },
        ],
        charges: [{ name: 'Tax', amount: 1 }],
      },
      2,
    )

    expect(result.items.map((i) => i.position)).toEqual([0, 1, 2])
  })

  describe('adjustment', () => {
    it('adds a positive adjustment when items sum below the total', () => {
      const result = normalizeReceipt(
        {
          merchant: null,
          date: null,
          currencyCode: null,
          total: 15,
          categoryId: null,
          items: [{ name: 'A', quantity: 1, amount: 10 }],
          charges: [],
        },
        2,
      )

      const adjustment = result.items.at(-1)!
      expect(adjustment).toMatchObject({
        name: 'Adjustment',
        amount: 500,
        isShared: true,
        isAdjustment: true,
      })
      expect(result.itemsTotal).toBe(1500)
    })

    it('adds a negative adjustment when items sum above the total', () => {
      const result = normalizeReceipt(
        {
          merchant: null,
          date: null,
          currencyCode: null,
          total: 8,
          categoryId: null,
          items: [{ name: 'A', quantity: 1, amount: 10 }],
          charges: [],
        },
        2,
      )

      const adjustment = result.items.at(-1)!
      expect(adjustment.amount).toBe(-200)
      expect(result.itemsTotal).toBe(800)
    })

    it('adds no adjustment when the sum equals the total', () => {
      const result = normalizeReceipt(
        {
          merchant: null,
          date: null,
          currencyCode: null,
          total: 12,
          categoryId: null,
          items: [{ name: 'A', quantity: 1, amount: 10 }],
          charges: [{ name: 'Tax', amount: 2 }],
        },
        2,
      )

      expect(result.items).toHaveLength(2)
      expect(result.items.some((i) => i.isAdjustment)).toBe(false)
    })

    it('adds no adjustment and uses the sum when total is null', () => {
      const result = normalizeReceipt(
        {
          merchant: null,
          date: null,
          currencyCode: null,
          total: null,
          categoryId: null,
          items: [{ name: 'A', quantity: 1, amount: 10 }],
          charges: [{ name: 'Tax', amount: 2 }],
        },
        2,
      )

      expect(result.items).toHaveLength(2)
      expect(result.itemsTotal).toBe(1200)
    })
  })

  describe('quantity', () => {
    const quantityOf = (quantity: number) => {
      const result = normalizeReceipt(
        {
          merchant: null,
          date: null,
          currencyCode: null,
          total: null,
          categoryId: null,
          items: [{ name: 'Item', quantity, amount: 1 }],
          charges: [],
        },
        2,
      )
      return result.items[0].quantityMilli
    }

    it('falls back to 1000 for non-positive or non-finite quantities', () => {
      expect(quantityOf(0)).toBe(1000)
      expect(quantityOf(-3)).toBe(1000)
      expect(quantityOf(Number.NaN)).toBe(1000)
    })

    it('converts fractional and integer quantities to thousandths', () => {
      expect(quantityOf(0.5)).toBe(500)
      expect(quantityOf(2)).toBe(2000)
    })
  })

  describe('metadata', () => {
    it('keeps a valid ISO date and nulls an invalid one', () => {
      const base = {
        merchant: null,
        currencyCode: null,
        total: null,
        categoryId: null,
        items: [],
        charges: [],
      }

      expect(normalizeReceipt({ ...base, date: '2026-04-01' }, 2).date).toBe(
        '2026-04-01',
      )
      expect(
        normalizeReceipt({ ...base, date: '01/04/2026' }, 2).date,
      ).toBeNull()
      expect(normalizeReceipt({ ...base, date: null }, 2).date).toBeNull()
    })

    it('trims the merchant and falls back to null when blank', () => {
      const base = {
        date: null,
        currencyCode: null,
        total: null,
        categoryId: null,
        items: [],
        charges: [],
      }

      expect(
        normalizeReceipt({ ...base, merchant: '  Café  ' }, 2).merchant,
      ).toBe('Café')
      expect(
        normalizeReceipt({ ...base, merchant: '   ' }, 2).merchant,
      ).toBeNull()
      expect(
        normalizeReceipt({ ...base, merchant: null }, 2).merchant,
      ).toBeNull()
    })

    it('stringifies a numeric categoryId', () => {
      const result = normalizeReceipt(
        {
          merchant: null,
          date: null,
          currencyCode: null,
          total: null,
          categoryId: 42,
          items: [],
          charges: [],
        },
        2,
      )

      expect(result.categoryId).toBe('42')
    })

    it('uppercases and trims the currency code', () => {
      const result = normalizeReceipt(
        {
          merchant: null,
          date: null,
          currencyCode: '  eur ',
          total: null,
          categoryId: null,
          items: [],
          charges: [],
        },
        2,
      )

      expect(result.currencyCode).toBe('EUR')
    })
  })
})

describe('RECEIPT_ITEMS_JSON_SCHEMA', () => {
  type JsonSchema = {
    type?: unknown
    additionalProperties?: boolean
    required?: string[]
    properties?: Record<string, JsonSchema>
    items?: JsonSchema
  }

  function assertStrictObject(schema: JsonSchema, path: string) {
    expect({ path, additionalProperties: schema.additionalProperties }).toEqual(
      {
        path,
        additionalProperties: false,
      },
    )
    const propertyNames = Object.keys(schema.properties ?? {}).sort()
    expect({ path, required: [...(schema.required ?? [])].sort() }).toEqual({
      path,
      required: propertyNames,
    })
    for (const [key, value] of Object.entries(schema.properties ?? {})) {
      if (value.type === 'object') assertStrictObject(value, `${path}.${key}`)
      if (value.type === 'array' && value.items?.type === 'object') {
        assertStrictObject(value.items, `${path}.${key}[]`)
      }
    }
  }

  it('is a strict object at every level, listing every property as required', () => {
    assertStrictObject(RECEIPT_ITEMS_JSON_SCHEMA as JsonSchema, '$')
  })
})
