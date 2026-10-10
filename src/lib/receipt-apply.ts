import { getExpense, getGroup, updateExpense } from '@/lib/api'
import type { RecurrenceRule } from '@/lib/enums'
import {
  computeReceiptSplitFor,
  getReceiptById,
  linkReceiptToExpense,
} from '@/lib/receipts'
import { expenseFormSchema, type ExpenseFormValues } from '@/lib/schemas'

export type ApplyReceiptInput = {
  groupId: string
  receiptId: string
  expenseId: string
  participantId?: string
}

/**
 * Applies a receipt's line items to an existing expense as a `BY_AMOUNT` split.
 *
 * The provisional split is always recomputed from the stored receipt items and
 * the group's participants; client-supplied totals are never trusted. The
 * resulting shares sum exactly to the receipt's items total, and the receipt is
 * linked to the expense so the screen can detect later divergence.
 */
export async function applyReceiptToExpense(
  input: ApplyReceiptInput,
): Promise<{ expenseId: string }> {
  const receipt = await getReceiptById(input.receiptId)
  if (!receipt || receipt.groupId !== input.groupId) {
    throw new Error('Receipt not found')
  }

  const expense = await getExpense(input.groupId, input.expenseId)
  if (!expense || expense.groupId !== input.groupId) {
    throw new Error('Expense not found')
  }

  const group = await getGroup(input.groupId)
  if (!group) {
    throw new Error('Group not found')
  }

  const split = computeReceiptSplitFor(receipt, group)

  if (split.allOptedOut) {
    throw new Error('Everyone opted out, but items are still unassigned.')
  }

  if (split.itemsTotal === 0) {
    throw new Error('The receipt has no items to apply.')
  }

  // A negative adjustment can push a participant's provisional total below
  // zero; filtering those rows out would break the `BY_AMOUNT` invariant, so
  // refuse to apply until the items are fixed.
  if (split.participants.some((participant) => participant.total < 0)) {
    throw new Error(
      'Some participants have a negative share; adjust the items before applying.',
    )
  }

  // The provisional totals sum exactly to the items total, so filtering out the
  // zero shares keeps the `BY_AMOUNT` invariant (Σ shares === amount).
  const paidFor = split.participants
    .filter((participant) => participant.total > 0)
    .map((participant) => ({
      participant: participant.participantId,
      shares: participant.total,
    }))

  const formValues: ExpenseFormValues = {
    expenseDate: expense.expenseDate,
    title: expense.title,
    category: expense.categoryId,
    amount: split.itemsTotal,
    paidBy: expense.paidById,
    paidFor,
    splitMode: 'BY_AMOUNT',
    isReimbursement: expense.isReimbursement,
    documents: expense.documents.map((document) => ({
      id: document.id,
      url: document.url,
      width: document.width,
      height: document.height,
    })),
    notes: expense.notes ?? undefined,
    recurrenceRule: expense.recurrenceRule as RecurrenceRule,
    saveDefaultSplittingOptions: false,
    // The applied amount is now the receipt's items total in the group currency.
    originalAmount: undefined,
    originalCurrency: undefined,
    conversionRate: undefined,
  }

  // Defence in depth: never write a row the expense schema rejects (e.g. shares
  // that do not sum exactly to the amount, or a zero share).
  if (!expenseFormSchema.safeParse(formValues).success) {
    throw new Error(
      'The receipt split is invalid; adjust the items before applying.',
    )
  }

  await updateExpense(
    input.groupId,
    input.expenseId,
    formValues,
    input.participantId,
  )
  await linkReceiptToExpense(input.receiptId, input.expenseId)

  return { expenseId: input.expenseId }
}
