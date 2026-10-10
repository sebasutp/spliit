import { applyReceiptToExpense } from '@/lib/receipt-apply'
import { baseProcedure } from '@/trpc/init'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const applyGroupReceiptToExpenseProcedure = baseProcedure
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
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            error instanceof Error
              ? error.message
              : 'Could not apply the receipt to the expense.',
        })
      }
    },
  )
