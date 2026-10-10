import { getExpense } from '@/lib/api'
import { linkReceiptToExpense } from '@/lib/receipts'
import { baseProcedure } from '@/trpc/init'
import { loadReceiptForGroup } from '@/trpc/routers/groups/receipts/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const linkGroupReceiptToExpenseProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      receiptId: z.string().min(1),
      expenseId: z.string().min(1),
    }),
  )
  .mutation(async ({ input: { groupId, receiptId, expenseId } }) => {
    // Validate both ends against the same group before linking, so a receipt
    // can never be attached to an expense from another group.
    await loadReceiptForGroup(groupId, receiptId)

    const expense = await getExpense(groupId, expenseId)
    if (!expense || expense.groupId !== groupId) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Expense not found',
      })
    }

    await linkReceiptToExpense(receiptId, expenseId)

    return { receiptId, expenseId }
  })
