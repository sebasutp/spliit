import { getGroup } from '@/lib/api'
import { computeReceiptSplitFor, getReceiptById } from '@/lib/receipts'
import { TRPCError } from '@trpc/server'

export { computeReceiptSplitFor }

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
