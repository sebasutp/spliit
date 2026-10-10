import { getExpense, getGroup, updateExpense } from '@/lib/api'
import { ReceiptStatus } from '@/lib/enums'
import { prisma } from '@/lib/prisma'
import { randomId } from '@/lib/random'
import { applyReceiptToExpense } from '@/lib/receipt-apply'
import { computeReceiptSplitFor, getReceiptById } from '@/lib/receipts'
import type { ExpenseFormValues } from '@/lib/schemas'

type StoredPortion = {
  target: 'PARTICIPANT' | 'SHARED'
  participantId?: string
  quantityMilli: number
}

describe('applyReceiptToExpense', () => {
  const groupId = randomId()
  const participantA = randomId()
  const participantB = randomId()
  const participantC = randomId()

  let categoryId: number

  beforeAll(async () => {
    const category = await prisma.category.create({
      data: {
        grouping: 'Receipt apply tests',
        name: `Receipt apply ${randomId()}`,
      },
    })
    categoryId = category.id

    await prisma.group.create({
      data: {
        id: groupId,
        name: 'Receipt Apply Group',
        participants: {
          createMany: {
            data: [
              { id: participantA, name: 'Alice' },
              { id: participantB, name: 'Bob' },
              { id: participantC, name: 'Carol' },
            ],
          },
        },
      },
    })
  })

  afterAll(async () => {
    // Receipts, items, portions, opt-outs and expenses cascade from the group.
    await prisma.group.deleteMany({ where: { id: groupId } })
    await prisma.category.delete({ where: { id: categoryId } })
  })

  /** Creates an extracted receipt with the given items and opt-outs. */
  async function createReceipt(data: {
    items: {
      name: string
      quantityMilli: number
      amount: number
      isShared: boolean
      isAdjustment?: boolean
      portions?: StoredPortion[]
    }[]
    optOuts?: string[]
  }): Promise<string> {
    const receiptId = randomId()
    await prisma.receipt.create({
      data: {
        id: receiptId,
        groupId,
        imageUrl: `https://example.com/${randomId()}.jpg`,
        status: ReceiptStatus.EXTRACTED,
        items: {
          create: data.items.map((item, position) => ({
            id: randomId(),
            name: item.name,
            quantityMilli: item.quantityMilli,
            amount: item.amount,
            isShared: item.isShared,
            isAdjustment: item.isAdjustment ?? false,
            position,
            portions: item.portions
              ? { createMany: { data: item.portions } }
              : undefined,
          })),
        },
        optOuts: data.optOuts
          ? {
              createMany: {
                data: data.optOuts.map((participantId) => ({ participantId })),
              },
            }
          : undefined,
      },
    })
    return receiptId
  }

  /** Creates an expense with a placeholder amount paid by Alice. */
  async function createExpense(): Promise<string> {
    const expenseId = randomId()
    await prisma.expense.create({
      data: {
        id: expenseId,
        groupId,
        title: 'Dinner',
        amount: 100,
        paidById: participantA,
        categoryId,
        notes: 'keep me',
        splitMode: 'EVENLY',
        documents: {
          create: {
            id: randomId(),
            url: 'https://example.com/receipt.jpg',
            width: 640,
            height: 480,
          },
        },
        paidFor: {
          createMany: {
            data: [{ participantId: participantA, shares: 100 }],
          },
        },
      },
    })
    return expenseId
  }

  async function splitFor(receiptId: string) {
    const receipt = (await getReceiptById(receiptId))!
    const group = (await getGroup(groupId))!
    return computeReceiptSplitFor(receipt, group)
  }

  /** Pizza (2 of 3 units assigned) plus a whole-bill shared tax. */
  async function createPizzaAndTaxReceipt(optOuts: string[] = []) {
    return createReceipt({
      items: [
        {
          name: 'Pizza',
          quantityMilli: 3000,
          amount: 900,
          isShared: false,
          portions: [
            {
              target: 'PARTICIPANT',
              participantId: participantA,
              quantityMilli: 1000,
            },
            {
              target: 'PARTICIPANT',
              participantId: participantB,
              quantityMilli: 1000,
            },
          ],
        },
        { name: 'Tax', quantityMilli: 1000, amount: 300, isShared: true },
      ],
      optOuts,
    })
  }

  it('applies the recomputed split as a BY_AMOUNT expense and links the receipt', async () => {
    const receiptId = await createPizzaAndTaxReceipt([participantC])
    const expenseId = await createExpense()

    const expected = await splitFor(receiptId)
    // Alice and Bob split the unassigned unit; Carol opted out of it but still
    // pays her share of the shared tax.
    expect(expected.itemsTotal).toBe(1200)
    expect(expected.sharedPool).toBe(300)
    expect(expected.unassignedPool).toBe(300)

    const result = await applyReceiptToExpense({
      groupId,
      receiptId,
      expenseId,
    })
    expect(result).toEqual({ expenseId })

    const expense = (await getExpense(groupId, expenseId))!
    expect(expense.splitMode).toBe('BY_AMOUNT')
    expect(expense.amount).toBe(expected.itemsTotal)
    expect(expense.amount).toBe(1200)

    // The rest of the expense is preserved.
    expect(expense.title).toBe('Dinner')
    expect(expense.notes).toBe('keep me')
    expect(expense.paidById).toBe(participantA)
    expect(expense.categoryId).toBe(categoryId)
    expect(expense.documents).toHaveLength(1)
    expect(expense.documents[0].url).toBe('https://example.com/receipt.jpg')

    // Shares equal the recomputed provisional totals and sum exactly to amount.
    const storedShares = new Map(
      expense.paidFor.map((paidFor) => [paidFor.participantId, paidFor.shares]),
    )
    const expectedShares = new Map(
      expected.participants
        .filter((participant) => participant.total > 0)
        .map((participant) => [participant.participantId, participant.total]),
    )
    expect(storedShares).toEqual(expectedShares)

    const sum = [...storedShares.values()].reduce(
      (total, shares) => total + shares,
      0,
    )
    expect(sum).toBe(expense.amount)
    expect(sum).toBe(expected.itemsTotal)

    // The receipt is linked to the expense it was applied to.
    const linked = (await getReceiptById(receiptId))!
    expect(linked.expenseId).toBe(expenseId)
  })

  it('charges an opted-out participant the shared pool but not the unassigned pool', async () => {
    const receiptId = await createPizzaAndTaxReceipt([participantC])
    const expenseId = await createExpense()

    const split = await splitFor(receiptId)
    const carol = split.participants.find(
      (participant) => participant.participantId === participantC,
    )!
    expect(carol.shared).toBe(100)
    expect(carol.unassigned).toBe(0)
    expect(carol.total).toBe(100)

    await applyReceiptToExpense({ groupId, receiptId, expenseId })

    const expense = (await getExpense(groupId, expenseId))!
    const carolShare = expense.paidFor.find(
      (paidFor) => paidFor.participantId === participantC,
    )!
    expect(carolShare.shares).toBe(100)
  })

  it('rejects an all-opted-out receipt with a non-empty unassigned pool and leaves the expense unchanged', async () => {
    const receiptId = await createPizzaAndTaxReceipt([
      participantA,
      participantB,
      participantC,
    ])
    const expenseId = await createExpense()

    const split = await splitFor(receiptId)
    expect(split.allOptedOut).toBe(true)
    expect(split.unassignedPool).toBe(300)

    const before = (await getExpense(groupId, expenseId))!
    const beforeReceipt = (await getReceiptById(receiptId))!

    await expect(
      applyReceiptToExpense({ groupId, receiptId, expenseId }),
    ).rejects.toThrow(/opted out/i)

    const after = (await getExpense(groupId, expenseId))!
    expect(after.amount).toBe(before.amount)
    expect(after.splitMode).toBe(before.splitMode)
    expect(after.paidFor.map((p) => [p.participantId, p.shares])).toEqual(
      before.paidFor.map((p) => [p.participantId, p.shares]),
    )

    const afterReceipt = (await getReceiptById(receiptId))!
    expect(afterReceipt.expenseId).toBeNull()
    expect(afterReceipt.items.map((item) => item.amount)).toEqual(
      beforeReceipt.items.map((item) => item.amount),
    )
  })

  it('rejects a negative participant total from a negative adjustment and leaves the expense unchanged', async () => {
    // Alice's dish (10.00) minus a 15.00 whole-bill discount pushes Bob and
    // Carol below zero; Carol opted out of the unassigned pool but shared
    // charges still land on everyone.
    const receiptId = await createReceipt({
      items: [
        {
          name: 'Pizza',
          quantityMilli: 1000,
          amount: 1000,
          isShared: false,
          portions: [
            {
              target: 'PARTICIPANT',
              participantId: participantA,
              quantityMilli: 1000,
            },
          ],
        },
        {
          name: 'Discount',
          quantityMilli: 1000,
          amount: -1500,
          isShared: true,
          isAdjustment: true,
        },
      ],
      optOuts: [participantC],
    })
    const expenseId = await createExpense()

    const split = await splitFor(receiptId)
    expect(split.allOptedOut).toBe(false)
    expect(split.itemsTotal).toBe(-500)
    expect(
      split.participants.some((participant) => participant.total < 0),
    ).toBe(true)

    const before = (await getExpense(groupId, expenseId))!
    const beforeReceipt = (await getReceiptById(receiptId))!

    await expect(
      applyReceiptToExpense({ groupId, receiptId, expenseId }),
    ).rejects.toThrow(/negative share/i)

    // Neither the expense nor the receipt link changed.
    const after = (await getExpense(groupId, expenseId))!
    expect(after.amount).toBe(before.amount)
    expect(after.splitMode).toBe(before.splitMode)
    expect(after.paidFor.map((p) => [p.participantId, p.shares])).toEqual(
      before.paidFor.map((p) => [p.participantId, p.shares]),
    )

    const afterReceipt = (await getReceiptById(receiptId))!
    expect(afterReceipt.expenseId).toBeNull()
    expect(afterReceipt.items.map((item) => item.amount)).toEqual(
      beforeReceipt.items.map((item) => item.amount),
    )
  })

  it('applies a positive adjustment together with the items', async () => {
    const receiptId = await createReceipt({
      items: [
        {
          name: 'Pizza',
          quantityMilli: 1000,
          amount: 1000,
          isShared: false,
          portions: [
            {
              target: 'PARTICIPANT',
              participantId: participantA,
              quantityMilli: 1000,
            },
          ],
        },
        {
          name: 'Service charge',
          quantityMilli: 1000,
          amount: 200,
          isShared: true,
          isAdjustment: true,
        },
      ],
      optOuts: [participantC],
    })
    const expenseId = await createExpense()

    const result = await applyReceiptToExpense({
      groupId,
      receiptId,
      expenseId,
    })
    expect(result).toEqual({ expenseId })

    const expense = (await getExpense(groupId, expenseId))!
    expect(expense.splitMode).toBe('BY_AMOUNT')
    expect(expense.amount).toBe(1200)

    const expected = await splitFor(receiptId)
    const expectedShares = new Map(
      expected.participants
        .filter((participant) => participant.total > 0)
        .map((participant) => [participant.participantId, participant.total]),
    )
    const storedShares = new Map(
      expense.paidFor.map((paidFor) => [paidFor.participantId, paidFor.shares]),
    )
    expect(storedShares).toEqual(expectedShares)
    expect(
      [...storedShares.values()].reduce((sum, value) => sum + value, 0),
    ).toBe(expense.amount)
  })

  it('does not re-apply after a later manual edit of the expense', async () => {
    const receiptId = await createPizzaAndTaxReceipt([participantC])
    const expenseId = await createExpense()

    await applyReceiptToExpense({ groupId, receiptId, expenseId })

    const applied = (await getExpense(groupId, expenseId))!
    const appliedReceipt = (await getReceiptById(receiptId))!

    // A user later edits the expense by hand.
    const manual: ExpenseFormValues = {
      expenseDate: applied.expenseDate,
      title: applied.title,
      category: applied.categoryId,
      amount: 999,
      paidBy: participantA,
      paidFor: [{ participant: participantA, shares: 999 }],
      splitMode: 'BY_AMOUNT',
      isReimbursement: applied.isReimbursement,
      documents: [],
      notes: applied.notes ?? undefined,
      recurrenceRule: 'NONE',
      saveDefaultSplittingOptions: false,
    }
    await updateExpense(groupId, expenseId, manual)

    const edited = (await getExpense(groupId, expenseId))!
    expect(edited.amount).toBe(999)
    expect(edited.paidFor.map((p) => [p.participantId, p.shares])).toEqual([
      [participantA, 999],
    ])

    // Nothing re-applies by itself: the receipt is still linked and its stored
    // items are untouched, even though the expense now diverges from the split.
    const receiptAfter = (await getReceiptById(receiptId))!
    expect(receiptAfter.expenseId).toBe(expenseId)
    expect(receiptAfter.items.map((item) => item.amount)).toEqual(
      appliedReceipt.items.map((item) => item.amount),
    )
    const splitAfter = await splitFor(receiptId)
    expect(splitAfter.itemsTotal).toBe(1200)
    expect(edited.amount).not.toBe(splitAfter.itemsTotal)
  })

  it('rejects a missing or cross-group receipt/expense', async () => {
    const receiptId = await createPizzaAndTaxReceipt()
    const expenseId = await createExpense()

    await expect(
      applyReceiptToExpense({ groupId, receiptId: randomId(), expenseId }),
    ).rejects.toThrow(/receipt not found/i)

    await expect(
      applyReceiptToExpense({ groupId, receiptId, expenseId: randomId() }),
    ).rejects.toThrow(/expense not found/i)
  })
})
