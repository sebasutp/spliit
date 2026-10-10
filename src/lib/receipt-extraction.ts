import { z } from 'zod'

export const MAX_RECEIPT_ITEMS = 200

const aiItemSchema = z.object({
  name: z.string(),
  quantity: z.number().finite(),
  unitPrice: z.number().finite().nullish(),
  amount: z.number().finite(),
})
const aiChargeSchema = z.object({
  name: z.string(),
  amount: z.number().finite(),
})

export const receiptItemsResponseSchema = z.object({
  merchant: z.string().nullish(),
  date: z.string().nullish(),
  currencyCode: z.string().nullish(),
  total: z.number().finite().nullish(),
  categoryId: z.union([z.string(), z.number()]).nullish(),
  items: z.array(aiItemSchema).default([]),
  charges: z.array(aiChargeSchema).default([]),
})
export type ReceiptItemsExtraction = z.infer<typeof receiptItemsResponseSchema>

/**
 * JSON schema handed to the model with `strict: true`.
 *
 * OpenAI's strict structured-output mode requires `additionalProperties: false`
 * and every property to be listed in `required` at each object level; optional
 * values are expressed as nullable types instead of being omitted.
 */
export const RECEIPT_ITEMS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'merchant',
    'date',
    'currencyCode',
    'total',
    'categoryId',
    'items',
    'charges',
  ],
  properties: {
    merchant: { type: ['string', 'null'] },
    date: { type: ['string', 'null'] },
    currencyCode: { type: ['string', 'null'] },
    total: { type: ['number', 'null'] },
    categoryId: { type: ['string', 'null'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'quantity', 'unitPrice', 'amount'],
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number' },
          unitPrice: { type: ['number', 'null'] },
          amount: { type: 'number' },
        },
      },
    },
    charges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'amount'],
        properties: {
          name: { type: 'string' },
          amount: { type: 'number' },
        },
      },
    },
  },
}

export type NormalizedReceiptItem = {
  name: string
  quantityMilli: number
  unitPrice: number | null
  amount: number
  isShared: boolean
  isAdjustment: boolean
  position: number
}

export type NormalizedReceipt = {
  merchant: string | null
  date: string | null
  currencyCode: string | null
  total: number | null
  categoryId: string | null
  items: NormalizedReceiptItem[]
  itemsTotal: number
}

/**
 * Parses the raw model message. Returns null for empty/garbage/schema-violating
 * content. Only the first `MAX_RECEIPT_ITEMS` items are kept; charges are kept
 * as-is (they are few and whole-bill by nature).
 */
export function parseReceiptItemsResponse(
  content: string | null,
): ReceiptItemsExtraction | null {
  if (content == null || content.trim() === '') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }

  const result = receiptItemsResponseSchema.safeParse(parsed)
  if (!result.success) return null

  return {
    ...result.data,
    items: result.data.items.slice(0, MAX_RECEIPT_ITEMS),
  }
}

/** Converts an extraction to stored shape (minor units). */
export function normalizeReceipt(
  extraction: ReceiptItemsExtraction,
  decimalDigits: number,
): NormalizedReceipt {
  const toMinor = (n: number) => Math.round(n * 10 ** decimalDigits)

  const items: NormalizedReceiptItem[] = []
  let position = 0

  for (const item of extraction.items) {
    items.push({
      name: item.name.trim() || 'Item',
      quantityMilli:
        item.quantity > 0 && Number.isFinite(item.quantity)
          ? Math.max(1, Math.round(item.quantity * 1000))
          : 1000,
      unitPrice: item.unitPrice == null ? null : toMinor(item.unitPrice),
      amount: toMinor(item.amount),
      isShared: false,
      isAdjustment: false,
      position: position++,
    })
  }

  for (const charge of extraction.charges) {
    items.push({
      name: charge.name.trim() || 'Charge',
      quantityMilli: 1000,
      unitPrice: null,
      amount: toMinor(charge.amount),
      isShared: true,
      isAdjustment: false,
      position: position++,
    })
  }

  const total = extraction.total == null ? null : toMinor(extraction.total)
  const sum = items.reduce((acc, item) => acc + item.amount, 0)

  if (total !== null && total !== sum) {
    items.push({
      name: 'Adjustment',
      quantityMilli: 1000,
      unitPrice: null,
      amount: total - sum,
      isShared: true,
      isAdjustment: true,
      position: position++,
    })
  }

  return {
    merchant: extraction.merchant?.trim() || null,
    date:
      extraction.date != null && /^\d{4}-\d{2}-\d{2}$/.test(extraction.date)
        ? extraction.date
        : null,
    currencyCode: extraction.currencyCode?.trim().toUpperCase() || null,
    total,
    categoryId:
      extraction.categoryId == null ? null : String(extraction.categoryId),
    items,
    itemsTotal: total !== null ? total : sum,
  }
}
