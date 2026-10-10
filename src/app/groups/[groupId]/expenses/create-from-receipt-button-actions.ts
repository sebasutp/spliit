'use server'
import {
  getAiProvider,
  getReceiptExtractModel,
  getReceiptItemsModel,
  openai,
} from '@/lib/ai/client'
import {
  buildReceiptExtractPrompt,
  buildReceiptItemsPrompt,
} from '@/lib/ai/prompts'
import { RECEIPT_EXTRACT_JSON_SCHEMA } from '@/lib/ai/schemas'
import { getCategories, getGroup } from '@/lib/api'
import { ReceiptStatus } from '@/lib/enums'
import { getRuntimeFeatureFlags } from '@/lib/featureFlags'
import {
  normalizeReceipt,
  parseReceiptItemsResponse,
  RECEIPT_ITEMS_JSON_SCHEMA,
} from '@/lib/receipt-extraction'
import {
  claimReceiptForExtraction,
  completeReceipt,
  createPendingReceipt,
  failReceipt,
  getReceiptByImage,
  type ReceiptWithItems,
} from '@/lib/receipts'
import { isAllowedUploadUrl } from '@/lib/uploaded-image-url'
import { formatCategoryForAIPrompt, getCurrencyFromGroup } from '@/lib/utils'
import { z } from 'zod'

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
  const categoryOptions = categories.map(formatCategoryForAIPrompt)

  const completion = await openai.chat.completions.create({
    model: getReceiptExtractModel(),
    response_format: {
      type: 'json_schema',
      json_schema: RECEIPT_EXTRACT_JSON_SCHEMA,
    },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildReceiptExtractPrompt(categoryOptions) },
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
 * without calling the model. `itemsTotal` prefers the stored total — which
 * `completeReceipt` writes as the printed total, falling back to the line sum
 * at extraction time — and falls back to the stored line amounts if it is null.
 * The category is recovered by re-parsing the raw extraction the first call
 * stored.
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
  const categoryOptions = categories.map(formatCategoryForAIPrompt)

  const receipt =
    existing ??
    (await createPendingReceipt({
      groupId: input.groupId,
      imageUrl: input.imageUrl,
      imageWidth: input.imageWidth,
      imageHeight: input.imageHeight,
    }))

  // One AI call per image under concurrency: only the caller that wins the
  // atomic claim may run (and pay for) the extraction. The claim is released
  // by `completeReceipt`/`failReceipt`; a crash is recovered after the stale
  // timeout.
  const claimed = await claimReceiptForExtraction(receipt.id)
  if (!claimed) {
    throw new Error('Receipt extraction is already in progress.')
  }

  const model = getReceiptItemsModel()
  const provider = getAiProvider()

  // Spend boundary: `isAllowedUploadUrl` blocks SSRF and the atomic claim
  // guarantees one paid call per `(groupId, imageUrl)`, but there is no
  // per-caller throttle here — a caller can still trigger one call for each
  // distinct uploaded image. Deployments that expose uploads broadly are
  // expected to rate-limit at the edge (reverse proxy / platform).
  let content: string | null = null
  try {
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
            { type: 'text', text: buildReceiptItemsPrompt(categoryOptions) },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: input.imageUrl } }],
        },
      ],
    })
    content = completion.choices.at(0)?.message.content ?? null
  } catch {
    // A thrown model call must not leave the receipt stuck in EXTRACTING until
    // the stale timeout; record the failure so a retry can reclaim it.
    await failReceipt(receipt.id, { rawExtraction: null, provider, model })
    return { status: 'FAILED', receiptId: receipt.id }
  }

  const parsed = parseReceiptItemsResponse(content)

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
