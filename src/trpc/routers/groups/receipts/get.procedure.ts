import { getReceiptForExpense, type ReceiptWithItems } from '@/lib/receipts'
import {
  computeReceiptSplitFor,
  loadReceiptForGroup,
  receiptProcedure,
} from '@/trpc/routers/groups/receipts/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

/**
 * Drops the stored raw model output before the receipt reaches the client. It
 * can be large, it is never used by the items screen, and the stored model
 * output should not be exposed to every client that can address the receipt.
 */
function toReceiptDto(
  receipt: ReceiptWithItems,
): Omit<ReceiptWithItems, 'rawExtraction'> {
  const { rawExtraction, ...dto } = receipt
  void rawExtraction
  return dto
}

export const getGroupReceiptProcedure = receiptProcedure
  .input(
    z
      .object({
        groupId: z.string().min(1),
        receiptId: z.string().min(1).optional(),
        expenseId: z.string().min(1).optional(),
      })
      .refine((input) => Boolean(input.receiptId || input.expenseId), {
        message: 'Either receiptId or expenseId is required',
        path: ['receiptId'],
      }),
  )
  .query(async ({ input: { groupId, receiptId, expenseId } }) => {
    // The receipt can be addressed directly or through its linked expense.
    let resolvedReceiptId = receiptId
    if (!resolvedReceiptId) {
      const linked = await getReceiptForExpense(groupId, expenseId!)
      if (!linked) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Receipt not found',
        })
      }
      resolvedReceiptId = linked.id
    }

    const { receipt, group } = await loadReceiptForGroup(
      groupId,
      resolvedReceiptId,
    )

    // Provisional totals are always recomputed from the stored items; client
    // supplied totals are never trusted.
    const split = computeReceiptSplitFor(receipt, group)

    return {
      receipt: toReceiptDto(receipt),
      split,
      participants: group.participants,
      optedOutParticipantIds: receipt.optOuts.map(
        (optOut) => optOut.participantId,
      ),
    }
  })
