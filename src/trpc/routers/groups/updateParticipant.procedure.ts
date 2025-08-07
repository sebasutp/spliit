import { db } from '@/lib/prisma'
import { privateProcedure } from '@/trpc/init'
import { z } from 'zod'

export const updateParticipantProcedure = privateProcedure
  .input(
    z.object({
      groupId: z.string(),
      participantId: z.string(),
      allExpensesAdded: z.boolean(),
    }),
  )
  .mutation(async ({ input }) => {
    const { groupId, participantId, allExpensesAdded } = input
    const participant = await db.participant.update({
      where: {
        id: participantId,
        groupId,
      },
      data: {
        allExpensesAdded,
      },
    })
    return { participant }
  })
