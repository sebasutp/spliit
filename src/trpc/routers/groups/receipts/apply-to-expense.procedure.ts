import { applyReceiptToExpense } from '@/lib/receipt-apply'
import { receiptProcedure } from '@/trpc/routers/groups/receipts/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const applyGroupReceiptToExpenseProcedure = receiptProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      receiptId: z.string().min(1),
      expenseId: z.string().min(1),
      participantId: z.string().min(1).optional(),
    }),
  )
  .mutation(
    async ({ input: { groupId, receiptId, expenseId, participantId } }) => {
      try {
        return await applyReceiptToExpense({
          groupId,
          receiptId,
          expenseId,
          participantId,
        })
      } catch (error) {
        if (error instanceof TRPCError) throw error
        const message =
          error instanceof Error
            ? error.message
            : 'Could not apply the receipt to the expense.'
        // A missing/cross-group receipt or expense is NOT_FOUND; everything else
        // (negative share, all opted out, invalid split) is a BAD_REQUEST.
        throw new TRPCError({
          code: /not found/i.test(message) ? 'NOT_FOUND' : 'BAD_REQUEST',
          message,
        })
      }
    },
  )
