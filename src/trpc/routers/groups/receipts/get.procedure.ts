import { getReceiptForExpense } from '@/lib/receipts'
import { baseProcedure } from '@/trpc/init'
import {
  computeReceiptSplitFor,
  loadReceiptForGroup,
} from '@/trpc/routers/groups/receipts/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const getGroupReceiptProcedure = baseProcedure
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
      receipt,
      split,
      participants: group.participants,
      optedOutParticipantIds: receipt.optOuts.map(
        (optOut) => optOut.participantId,
      ),
    }
  })
