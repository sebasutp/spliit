import { getGroup } from '@/lib/api'
import { getRuntimeFeatureFlags } from '@/lib/featureFlags'
import { computeReceiptSplitFor, getReceiptById } from '@/lib/receipts'
import { baseProcedure } from '@/trpc/init'
import { TRPCError } from '@trpc/server'

export { computeReceiptSplitFor }

/**
 * Upper bounds for the receipt-item mutations, so a caller cannot post unbounded
 * payloads. `MAX_RECEIPT_ITEM_AMOUNT` mirrors the expense form's 10,000,000.00
 * ceiling (in minor units); quantities are in thousandths.
 */
export const MAX_RECEIPT_ITEM_NAME_LENGTH = 200
export const MAX_RECEIPT_ITEM_AMOUNT = 10_000_000_00
export const MAX_RECEIPT_ITEM_QUANTITY_MILLI = 1_000_000_000
export const MAX_RECEIPT_ITEM_PORTIONS = 100

/**
 * Server-side gate for the receipt-items calculator. The UI only hides the entry
 * point, so the whole `groups.receipts.*` router — including the apply path —
 * must refuse when the flag is off.
 */
export const receiptProcedure = baseProcedure.use(async ({ next }) => {
  const { enableReceiptItems } = await getRuntimeFeatureFlags()
  if (!enableReceiptItems) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Receipt items are not enabled.',
    })
  }
  return next()
})

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
