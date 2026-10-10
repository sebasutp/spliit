import { Prisma } from '@/generated/prisma/client'
import { ReceiptStatus } from '@/lib/enums'
import { prisma } from '@/lib/prisma'
import { randomId } from '@/lib/random'
import type { NormalizedReceipt } from '@/lib/receipt-extraction'

/**
 * Shared include for every receipt getter: items in display order with their
 * portions, plus the per-participant opt-outs.
 */
const receiptInclude = {
  items: {
    orderBy: { position: 'asc' },
    include: { portions: true },
  },
  optOuts: true,
} satisfies Prisma.ReceiptInclude

export async function getReceiptById(receiptId: string) {
  return prisma.receipt.findUnique({
    where: { id: receiptId },
    include: receiptInclude,
  })
}

export type ReceiptWithItems = NonNullable<
  Awaited<ReturnType<typeof getReceiptById>>
>

export async function getReceiptByImage(groupId: string, imageUrl: string) {
  return prisma.receipt.findUnique({
    where: { groupId_imageUrl: { groupId, imageUrl } },
    include: receiptInclude,
  })
}

export async function getReceiptForExpense(groupId: string, expenseId: string) {
  return prisma.receipt.findFirst({
    where: { groupId, expenseId },
    include: receiptInclude,
  })
}

/** True when `error` is Prisma's unique-constraint violation (P2002). */
function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

/**
 * Creates a PENDING receipt for an uploaded image. Parsing is a single AI call
 * keyed on `(groupId, imageUrl)`, so concurrent uploaders race here; the loser
 * of the race gets the row the winner created instead of an error.
 */
export async function createPendingReceipt(input: {
  groupId: string
  imageUrl: string
  imageWidth?: number | null
  imageHeight?: number | null
}): Promise<ReceiptWithItems> {
  try {
    return await prisma.receipt.create({
      data: {
        id: randomId(),
        groupId: input.groupId,
        imageUrl: input.imageUrl,
        imageWidth: input.imageWidth ?? null,
        imageHeight: input.imageHeight ?? null,
        status: ReceiptStatus.PENDING,
      },
      include: receiptInclude,
    })
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existing = await getReceiptByImage(input.groupId, input.imageUrl)
      if (existing) return existing
    }
    throw error
  }
}

/**
 * Stores a successful extraction: flips the receipt to EXTRACTED, records the
 * raw/provider/model metadata and normalized header, then replaces the line
 * items with the freshly normalized ones.
 */
export async function completeReceipt(
  receiptId: string,
  data: {
    rawExtraction: string | null
    provider: string | null
    model: string | null
    normalized: NormalizedReceipt
  },
): Promise<ReceiptWithItems> {
  const { normalized } = data
  const receiptDate = normalized.date
    ? new Date(`${normalized.date}T12:00:00.000Z`)
    : null
  const total = normalized.total ?? normalized.itemsTotal

  return prisma.$transaction(async (transaction) => {
    await transaction.receipt.update({
      where: { id: receiptId },
      data: {
        status: ReceiptStatus.EXTRACTED,
        rawExtraction: data.rawExtraction,
        provider: data.provider,
        model: data.model,
        merchant: normalized.merchant,
        receiptDate,
        currencyCode: normalized.currencyCode,
        total,
      },
    })

    await transaction.receiptItem.deleteMany({ where: { receiptId } })

    if (normalized.items.length > 0) {
      await transaction.receiptItem.createMany({
        data: normalized.items.map((item) => ({
          id: randomId(),
          receiptId,
          name: item.name,
          quantityMilli: item.quantityMilli,
          unitPrice: item.unitPrice,
          amount: item.amount,
          isShared: item.isShared,
          isAdjustment: item.isAdjustment,
          position: item.position,
        })),
      })
    }

    const receipt = await transaction.receipt.findUnique({
      where: { id: receiptId },
      include: receiptInclude,
    })
    if (!receipt) throw new Error(`Receipt not found: ${receiptId}`)

    return receipt
  })
}

export async function failReceipt(
  receiptId: string,
  data: {
    rawExtraction: string | null
    provider: string | null
    model: string | null
  },
): Promise<void> {
  await prisma.receipt.update({
    where: { id: receiptId },
    data: {
      status: ReceiptStatus.FAILED,
      rawExtraction: data.rawExtraction,
      provider: data.provider,
      model: data.model,
    },
  })
}

export async function linkReceiptToExpense(
  receiptId: string,
  expenseId: string | null,
): Promise<void> {
  await prisma.receipt.update({
    where: { id: receiptId },
    data: { expenseId },
  })
}
