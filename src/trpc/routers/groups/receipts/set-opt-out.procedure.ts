import { setReceiptOptOut } from '@/lib/receipts'
import { baseProcedure } from '@/trpc/init'
import {
  loadReceiptForGroup,
  reloadReceiptSplit,
} from '@/trpc/routers/groups/receipts/shared'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'

export const setGroupReceiptOptOutProcedure = baseProcedure
  .input(
    z.object({
      groupId: z.string().min(1),
      receiptId: z.string().min(1),
      participantId: z.string().min(1),
      optedOut: z.boolean(),
    }),
  )
  .mutation(
    async ({ input: { groupId, receiptId, participantId, optedOut } }) => {
      const { group } = await loadReceiptForGroup(groupId, receiptId)

      if (!group.participants.some((p) => p.id === participantId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Participant is not in the group',
        })
      }

      await setReceiptOptOut(receiptId, participantId, optedOut)

      const split = await reloadReceiptSplit(receiptId, group)
      return { split }
    },
  )
