import { createTRPCRouter } from '@/trpc/init'
import { getGroupReceiptProcedure } from '@/trpc/routers/groups/receipts/get.procedure'

export const groupReceiptsRouter = createTRPCRouter({
  get: getGroupReceiptProcedure,
})
