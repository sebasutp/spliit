import { addReceiptItem } from '@/lib/receipts'
import {
  MAX_RECEIPT_ITEM_AMOUNT,
  MAX_RECEIPT_ITEM_NAME_LENGTH,
  MAX_RECEIPT_ITEM_QUANTITY_MILLI,
  loadReceiptForGroup,
  receiptProcedure,
  reloadReceiptSplit,
} from '@/trpc/routers/groups/receipts/shared'
import { z } from 'zod'

export const addGroupReceiptItemProcedure = receiptProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      receiptId: z.string().min(1),
      name: z.string().min(1).max(MAX_RECEIPT_ITEM_NAME_LENGTH),
      quantityMilli: z
        .number()
        .int()
        .positive()
        .max(MAX_RECEIPT_ITEM_QUANTITY_MILLI),
      amount: z.number().int().positive().max(MAX_RECEIPT_ITEM_AMOUNT),
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
