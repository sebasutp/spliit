import { createTRPCRouter } from '@/trpc/init'
import { addGroupReceiptItemProcedure } from '@/trpc/routers/groups/receipts/add-item.procedure'
import { deleteGroupReceiptItemProcedure } from '@/trpc/routers/groups/receipts/delete-item.procedure'
import { getGroupReceiptProcedure } from '@/trpc/routers/groups/receipts/get.procedure'
import { setGroupReceiptItemPortionsProcedure } from '@/trpc/routers/groups/receipts/set-item-portions.procedure'
import { setGroupReceiptOptOutProcedure } from '@/trpc/routers/groups/receipts/set-opt-out.procedure'
import { updateGroupReceiptItemProcedure } from '@/trpc/routers/groups/receipts/update-item.procedure'

export const groupReceiptsRouter = createTRPCRouter({
  get: getGroupReceiptProcedure,
  setItemPortions: setGroupReceiptItemPortionsProcedure,
  updateItem: updateGroupReceiptItemProcedure,
  addItem: addGroupReceiptItemProcedure,
  deleteItem: deleteGroupReceiptItemProcedure,
  setOptOut: setGroupReceiptOptOutProcedure,
})
