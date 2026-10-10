import { addReceiptItem } from '@/lib/receipts'
import { baseProcedure } from '@/trpc/init'
import {
  loadReceiptForGroup,
  reloadReceiptSplit,
} from '@/trpc/routers/groups/receipts/shared'
import { z } from 'zod'

export const addGroupReceiptItemProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      receiptId: z.string().min(1),
      name: z.string().min(1),
      quantityMilli: z.number().int().positive(),
      amount: z.number().int().positive(),
      isShared: z.boolean(),
    }),
  )
  .mutation(
    async ({
      input: { groupId, receiptId, name, quantityMilli, amount, isShared },
    }) => {
      const { group } = await loadReceiptForGroup(groupId, receiptId)

      await addReceiptItem(receiptId, {
        name,
        quantityMilli,
        amount,
        isShared,
      })

      const split = await reloadReceiptSplit(receiptId, group)
      return { split }
    },
  )
