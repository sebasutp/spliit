import { updateReceiptItem } from '@/lib/receipts'
import {
  MAX_RECEIPT_ITEM_AMOUNT,
  MAX_RECEIPT_ITEM_NAME_LENGTH,
  MAX_RECEIPT_ITEM_QUANTITY_MILLI,
  loadReceiptForGroup,
  receiptProcedure,
  reloadReceiptSplit,
} from '@/trpc/routers/groups/receipts/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const updateGroupReceiptItemProcedure = receiptProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      receiptId: z.string().min(1),
      itemId: z.string().min(1),
      name: z.string().min(1).max(MAX_RECEIPT_ITEM_NAME_LENGTH).optional(),
      quantityMilli: z
        .number()
        .int()
        .positive()
        .max(MAX_RECEIPT_ITEM_QUANTITY_MILLI)
        .optional(),
      amount: z
        .number()
        .int()
        .positive()
        .max(MAX_RECEIPT_ITEM_AMOUNT)
        .optional(),
      isShared: z.boolean().optional(),
    }),
  )
  .mutation(
    async ({
      input: {
        groupId,
        receiptId,
        itemId,
        name,
        quantityMilli,
        amount,
        isShared,
      },
    }) => {
      const { receipt, group } = await loadReceiptForGroup(groupId, receiptId)

      const item = receipt.items.find((candidate) => candidate.id === itemId)
      if (!item) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Item not found',
        })
      }

      await updateReceiptItem(receiptId, itemId, {
        name,
        quantityMilli,
        amount,
        isShared,
      })

      const split = await reloadReceiptSplit(receiptId, group)
      return { split }
    },
  )
