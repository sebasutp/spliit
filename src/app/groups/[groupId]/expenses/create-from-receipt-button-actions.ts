'use server'
import { getCategories, getGroup } from '@/lib/api'
import { ReceiptStatus } from '@/lib/enums'
import { env } from '@/lib/env'
import { getRuntimeFeatureFlags } from '@/lib/featureFlags'
import {
  normalizeReceipt,
  parseReceiptItemsResponse,
  RECEIPT_ITEMS_JSON_SCHEMA,
} from '@/lib/receipt-extraction'
import {
  completeReceipt,
  createPendingReceipt,
  failReceipt,
  getReceiptByImage,
  type ReceiptWithItems,
} from '@/lib/receipts'
import { isAllowedUploadUrl } from '@/lib/uploaded-image-url'
import { formatCategoryForAIPrompt, getCurrencyFromGroup } from '@/lib/utils'
import OpenAI from 'openai'
import { z } from 'zod'

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseURL: env.OPENAI_BASE_URL,
})

// The model is contractually bound to this shape by `strict: true` below, but
// the response is still parsed rather than trusted: a self-hosted or older
// endpoint may ignore the schema.
const receiptResponseSchema = z.object({
  amount: z.number(),
  categoryId: z.string(),
  date: z.string(),
  title: z.string(),
})

export async function extractExpenseInformationFromImage(imageUrl: string) {
  'use server'

  // Enforce the feature flag server-side: the UI gate only hides the button, it
  // does not prevent the action endpoint from being invoked directly.
  const { enableReceiptExtract } = await getRuntimeFeatureFlags()
  if (!enableReceiptExtract) {
    throw new Error('Receipt extraction is not enabled.')
  }

  // Only extract from images the app itself uploaded. Without this, an arbitrary
  // caller-supplied URL is forwarded to the model, enabling SSRF-via-OpenAI and
  // unbounded API spend.
  if (!isAllowedUploadUrl(imageUrl)) {
    throw new Error('Invalid image URL.')
  }

  const categories = await getCategories()

  const completion = await openai.chat.completions.create({
    model: env.OPENAI_MODEL_RECEIPT_EXTRACT,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'receipt_response',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            amount: { type: 'number' },
            categoryId: { type: 'string' },
            date: { type: 'string' },
            title: { type: 'string' },
          },
          required: ['amount', 'categoryId', 'date', 'title'],
          additionalProperties: false,
        },
      },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `
              This image contains a receipt.
              Read the total amount and store it as a non-formatted number without any other text or currency.
              Then guess the category for this receipt among the following categories and store its ID: ${categories.map(
                (category) => formatCategoryForAIPrompt(category),
              )}.
              Guess the expense’s date and store it as yyyy-mm-dd.
              Guess a title for the expense.`,
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: imageUrl } }],
      },
    ],
  })

  const messageContent = completion.choices.at(0)?.message.content
  const parsed = (() => {
    if (!messageContent) return null
    try {
      return receiptResponseSchema.parse(JSON.parse(messageContent))
    } catch {
      // Malformed or schema-violating output: report "nothing extracted"
      // rather than passing junk on to the expense form.
      return null
    }
  })()

  const amount = Number(parsed?.amount)
  return {
    amount: Number.isFinite(amount) ? amount : null,
    categoryId: parsed?.categoryId ?? null,
    date: parsed?.date ?? null,
    title: parsed?.title ?? null,
  }
}

export type ReceiptExtractedInfo = Awaited<
  ReturnType<typeof extractExpenseInformationFromImage>
>

export type ReceiptItemsExtractionResult =
  | {
      status: 'EXTRACTED'
      receiptId: string
      total: number | null
      itemsTotal: number
      merchant: string | null
      date: string | null
      currencyCode: string | null
      categoryId: string | null
    }
  | { status: 'FAILED'; receiptId: string }

/**
 * Rebuilds the action's result from an already-persisted EXTRACTED receipt,
 * without calling the model. `itemsTotal` is recomputed from the stored line
 * amounts (falling back to the stored total when there are no lines), and the
 * category is recovered by re-parsing the raw extraction the first call stored.
 */
function toExtractedResult(
  existing: ReceiptWithItems,
): ReceiptItemsExtractionResult {
  const sum = existing.items.reduce((total, item) => total + item.amount, 0)
  const parsed = parseReceiptItemsResponse(existing.rawExtraction)

  return {
    status: 'EXTRACTED',
    receiptId: existing.id,
    total: existing.total,
    itemsTotal: existing.total ?? sum,
    merchant: existing.merchant,
    date: existing.receiptDate
      ? existing.receiptDate.toISOString().slice(0, 10)
      : null,
    currencyCode: existing.currencyCode,
    categoryId: parsed?.categoryId == null ? null : String(parsed.categoryId),
  }
}

/**
 * v2 extraction: one AI call per `(groupId, imageUrl)` reads the receipt's line
 * items and whole-bill charges, persists them normalized to minor units, and
 * returns the stored values. Re-uploading the same image reuses the existing
 * EXTRACTED parse instead of paying for another call.
 */
export async function extractReceiptItemsForImage(input: {
  groupId: string
  imageUrl: string
  imageWidth?: number | null
  imageHeight?: number | null
}): Promise<ReceiptItemsExtractionResult> {
  'use server'

  // Server-side flag enforcement: the UI gate only hides the button.
  const { enableReceiptItems } = await getRuntimeFeatureFlags()
  if (!enableReceiptItems) {
    throw new Error('Receipt items extraction is not enabled.')
  }

  // Only forward images the app itself uploaded, before any model call.
  if (!isAllowedUploadUrl(input.imageUrl)) {
    throw new Error('Invalid image URL.')
  }

  const existing = await getReceiptByImage(input.groupId, input.imageUrl)
  if (existing?.status === ReceiptStatus.EXTRACTED) {
    // One AI call per image: a previous successful parse is reused as-is.
    return toExtractedResult(existing)
  }

  const group = await getGroup(input.groupId)
  if (!group) {
    throw new Error(`Invalid group ID: ${input.groupId}`)
  }

  const categories = await getCategories()

  const receipt =
    existing ??
    (await createPendingReceipt({
      groupId: input.groupId,
      imageUrl: input.imageUrl,
      imageWidth: input.imageWidth,
      imageHeight: input.imageHeight,
    }))

  const model =
    env.OPENAI_MODEL_RECEIPT_ITEMS_EXTRACT ?? env.OPENAI_MODEL_RECEIPT_EXTRACT

  const completion = await openai.chat.completions.create({
    model,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'receipt_items_response',
        strict: true,
        schema: RECEIPT_ITEMS_JSON_SCHEMA,
      },
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `
              This image contains a receipt.
              Read the merchant name and store it (or null if unreadable).
              Guess the expense's date and store it as yyyy-mm-dd (or null if unreadable).
              Read the ISO 4217 currency code (or null if unreadable).
              Read the printed total as a plain number without currency symbols or other text (or null if unreadable).
              Then guess the category for this receipt among the following categories and store its ID: ${categories.map(
                (category) => formatCategoryForAIPrompt(category),
              )}.
              List every purchased line item under "items", each with:
                - name: the item's name as printed
                - quantity: the purchased quantity as a plain number (e.g. 1, 2, 0.5)
                - unitPrice: the price of one unit as a plain number (or null if not shown)
                - amount: the line total as a plain number
              Separately, list whole-bill charges under "charges", each with a name and a plain-number amount.
              Only tax, tip, service charge, cover charge and delivery are charges.
              A normal purchased item must never be listed as a charge.`,
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: input.imageUrl } }],
      },
    ],
  })

  const content = completion.choices.at(0)?.message.content ?? null
  const parsed = parseReceiptItemsResponse(content)
  const provider = env.OPENAI_BASE_URL ?? 'openai'

  if (!parsed) {
    // Malformed or schema-violating output: record the failure on the receipt
    // rather than passing junk on to the items screen.
    await failReceipt(receipt.id, { rawExtraction: content, provider, model })
    return { status: 'FAILED', receiptId: receipt.id }
  }

  const currency = getCurrencyFromGroup(group)
  const normalized = normalizeReceipt(parsed, currency.decimal_digits)

  const saved = await completeReceipt(receipt.id, {
    rawExtraction: content,
    provider,
    model,
    normalized,
  })

  return {
    status: 'EXTRACTED',
    receiptId: saved.id,
    total: saved.total,
    itemsTotal: normalized.itemsTotal,
    merchant: saved.merchant,
    date: normalized.date,
    currencyCode: saved.currencyCode,
    categoryId: normalized.categoryId,
  }
}
