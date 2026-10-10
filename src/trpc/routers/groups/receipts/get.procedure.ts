import { getGroup } from '@/lib/api'
import type { ReceiptPortionTarget } from '@/lib/enums'
import { computeReceiptSplit, toReceiptSplitItems } from '@/lib/receipt-split'
import { getReceiptById, getReceiptForExpense } from '@/lib/receipts'
import { baseProcedure } from '@/trpc/init'
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
    const receipt = receiptId
      ? await getReceiptById(receiptId)
      : await getReceiptForExpense(groupId, expenseId!)

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

    const participantIds = group.participants.map(
      (participant) => participant.id,
    )
    const optedOutParticipantIds = receipt.optOuts.map(
      (optOut) => optOut.participantId,
    )

    // Provisional totals are always recomputed from the stored items; client
    // supplied totals are never trusted.
    const split = computeReceiptSplit({
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

    return {
      receipt,
      split,
      participants: group.participants,
      optedOutParticipantIds,
    }
  })
