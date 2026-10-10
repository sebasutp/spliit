import { getGroup } from '@/lib/api'
import type { ReceiptPortionTarget } from '@/lib/enums'
import { computeReceiptSplit, toReceiptSplitItems } from '@/lib/receipt-split'
import { getReceiptById, type ReceiptWithItems } from '@/lib/receipts'
import { TRPCError } from '@trpc/server'

/**
 * Loads a receipt and its group, rejecting a missing receipt or a receipt that
 * belongs to a different group.
 */
export async function loadReceiptForGroup(groupId: string, receiptId: string) {
  const receipt = await getReceiptById(receiptId)
  if (!receipt || receipt.groupId !== groupId) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Receipt not found',
    })
  }

  const group = await getGroup(groupId)
  if (!group) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Group not found',
    })
  }

  return { receipt, group }
}

/**
 * Recomputes the provisional split for a receipt from its stored items and the
 * group's participants. Client-supplied totals are never trusted.
 */
export function computeReceiptSplitFor(
  receipt: ReceiptWithItems,
  group: { participants: { id: string }[] },
) {
  const participantIds = group.participants.map((participant) => participant.id)
  const optedOutParticipantIds = receipt.optOuts.map(
    (optOut) => optOut.participantId,
  )

  return computeReceiptSplit({
    participantIds,
    optedOutParticipantIds,
    items: toReceiptSplitItems(
      receipt.items.map((item) => ({
        amount: item.amount,
        quantityMilli: item.quantityMilli,
        isShared: item.isShared,
        portions: item.portions.map((portion) => ({
          target: portion.target as ReceiptPortionTarget,
          participantId: portion.participantId,
          quantityMilli: portion.quantityMilli,
        })),
      })),
    ),
  })
}

/** Reloads a receipt after a mutation and recomputes its provisional split. */
export async function reloadReceiptSplit(
  receiptId: string,
  group: { participants: { id: string }[] },
) {
  const receipt = await getReceiptById(receiptId)
  if (!receipt) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Receipt not found',
    })
  }
  return computeReceiptSplitFor(receipt, group)
}
