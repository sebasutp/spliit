import { deleteReceiptItem } from '@/lib/receipts'
import {
  loadReceiptForGroup,
  receiptProcedure,
  reloadReceiptSplit,
} from '@/trpc/routers/groups/receipts/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const deleteGroupReceiptItemProcedure = receiptProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      receiptId: z.string().min(1),
      itemId: z.string().min(1),
    }),
  )
  .mutation(async ({ input: { groupId, receiptId, itemId } }) => {
    const { receipt, group } = await loadReceiptForGroup(groupId, receiptId)

    const item = receipt.items.find((candidate) => candidate.id === itemId)
    if (!item) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Item not found',
      })
    }

    await deleteReceiptItem(receiptId, itemId)

    const split = await reloadReceiptSplit(receiptId, group)
    return { split }
  })
