import { setReceiptItemPortions } from '@/lib/receipts'
import { baseProcedure } from '@/trpc/init'
import {
  loadReceiptForGroup,
  reloadReceiptSplit,
} from '@/trpc/routers/groups/receipts/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

const portionSchema = z.object({
  target: z.enum(['PARTICIPANT', 'SHARED']),
  participantId: z.string().min(1).nullable().optional(),
  quantityMilli: z.number().int().min(0),
})

export const setGroupReceiptItemPortionsProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      receiptId: z.string().min(1),
      itemId: z.string().min(1),
      portions: z.array(portionSchema),
    }),
  )
  .mutation(async ({ input: { groupId, receiptId, itemId, portions } }) => {
    const { receipt, group } = await loadReceiptForGroup(groupId, receiptId)

    const item = receipt.items.find((candidate) => candidate.id === itemId)
    if (!item) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Item not found',
      })
    }

    const participantIds = new Set(
      group.participants.map((participant) => participant.id),
    )

    let assignedQuantity = 0
    for (const portion of portions) {
      assignedQuantity += portion.quantityMilli
      if (portion.target === 'PARTICIPANT') {
        if (
          !portion.participantId ||
          !participantIds.has(portion.participantId)
        ) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Invalid participant for portion',
          })
        }
      }
    }

    if (assignedQuantity > item.quantityMilli) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Portions exceed the item quantity',
      })
    }

    await setReceiptItemPortions(
      receiptId,
      itemId,
      portions.map((portion) => ({
        target: portion.target,
        participantId: portion.participantId ?? null,
        quantityMilli: portion.quantityMilli,
      })),
    )

    const split = await reloadReceiptSplit(receiptId, group)
    return { split }
  })
