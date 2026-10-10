import { ReceiptStatus } from '@/lib/enums'
import { prisma } from '@/lib/prisma'
import { randomId } from '@/lib/random'
import type { ReceiptSplitResult } from '@/lib/receipt-split'
import { groupsRouter } from './routers/groups'

describe('group receipts.get procedure', () => {
  const caller = groupsRouter.createCaller({ user: null })

  const groupId = randomId()
  const participantA = randomId()
  const participantB = randomId()
  const participantC = randomId()

  const otherGroupId = randomId()
  const otherParticipantId = randomId()

  const receiptId = randomId()
  const otherReceiptId = randomId()
  const expenseId = randomId()

  let categoryId: number

  beforeAll(async () => {
    const category = await prisma.category.create({
      data: {
        grouping: 'Receipt tRPC tests',
        name: `Receipt tRPC ${randomId()}`,
      },
    })
    categoryId = category.id

    await prisma.group.create({
      data: {
        id: groupId,
        name: 'Receipt tRPC Group',
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

    // 900 normal item with two of three units assigned (Carol's unit stays in
    // the unassigned pool), plus a 300 whole-bill shared charge.
    await prisma.receipt.create({
      data: {
        id: receiptId,
        groupId,
        imageUrl: `https://example.com/${randomId()}.jpg`,
        status: ReceiptStatus.EXTRACTED,
        items: {
          create: [
            {
              id: randomId(),
              name: 'Pizza',
              quantityMilli: 3000,
              amount: 900,
              isShared: false,
              position: 0,
              portions: {
                createMany: {
                  data: [
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
              },
            },
            {
              id: randomId(),
              name: 'Tax',
              quantityMilli: 1000,
              amount: 300,
              isShared: true,
              position: 1,
            },
          ],
        },
        optOuts: {
          createMany: {
            data: [{ participantId: participantC }],
          },
        },
      },
    })

    await prisma.expense.create({
      data: {
        id: expenseId,
        groupId,
        title: 'Dinner',
        amount: 1200,
        paidById: participantA,
        categoryId,
      },
    })

    await prisma.group.create({
      data: {
        id: otherGroupId,
        name: 'Other Receipt tRPC Group',
        participants: {
          create: { id: otherParticipantId, name: 'Zoe' },
        },
      },
    })

    await prisma.receipt.create({
      data: {
        id: otherReceiptId,
        groupId: otherGroupId,
        imageUrl: `https://example.com/${randomId()}.jpg`,
        status: ReceiptStatus.EXTRACTED,
      },
    })
  })

  afterAll(async () => {
    // Receipts, items, portions and opt-outs cascade from their group.
    await prisma.group.deleteMany({
      where: { id: { in: [groupId, otherGroupId] } },
    })
    await prisma.category.delete({ where: { id: categoryId } })
  })

  it('returns the receipt and a provisional split recomputed from stored items', async () => {
    const result = await caller.receipts.get({ groupId, receiptId })

    expect(result.receipt.id).toBe(receiptId)
    expect(result.participants.map((p) => p.id).sort()).toEqual(
      [participantA, participantB, participantC].sort(),
    )
    expect(result.optedOutParticipantIds).toEqual([participantC])

    const { split } = result
    expect(split.itemsTotal).toBe(1200)
    expect(split.sharedPool).toBe(300)
    expect(split.unassignedPool).toBe(300)

    const byParticipant = new Map(
      split.participants.map((share) => [share.participantId, share]),
    )
    const alice = byParticipant.get(participantA)!
    const bob = byParticipant.get(participantB)!
    const carol = byParticipant.get(participantC)!

    // Participant totals sum to the items total, so nothing leaks.
    const sum = split.participants.reduce(
      (total, share) => total + share.total,
      0,
    )
    expect(sum).toBe(split.itemsTotal)
    expect(sum).toBe(1200)

    // The shared charge is paid by everyone, opt-outs included.
    for (const share of split.participants) {
      expect(share.shared).toBe(100)
    }

    // The opted-out participant pays none of the unassigned pool...
    expect(carol.unassigned).toBe(0)
    // ...while the remaining participants split it evenly.
    expect(alice.unassigned).toBe(150)
    expect(bob.unassigned).toBe(150)

    expect(alice.direct).toBe(300)
    expect(bob.direct).toBe(300)
    expect(carol.direct).toBe(0)

    expect(alice.total).toBe(550)
    expect(bob.total).toBe(550)
    // Carol only pays her share of the shared charge.
    expect(carol.total).toBe(100)
  })

  it('resolves the linked receipt by expenseId and is NOT_FOUND before linking', async () => {
    await expect(
      caller.receipts.get({ groupId, expenseId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await prisma.receipt.update({
      where: { id: receiptId },
      data: { expenseId },
    })

    const result = await caller.receipts.get({ groupId, expenseId })
    expect(result.receipt.id).toBe(receiptId)
  })

  it('rejects a receiptId that belongs to another group', async () => {
    await expect(
      caller.receipts.get({ groupId, receiptId: otherReceiptId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects a missing group or a missing receipt/expense', async () => {
    await expect(
      caller.receipts.get({ groupId: randomId(), receiptId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await expect(
      caller.receipts.get({ groupId, receiptId: randomId() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await expect(
      caller.receipts.get({ groupId, expenseId: randomId() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('group receipts mutations', () => {
  const caller = groupsRouter.createCaller({ user: null })

  const groupId = randomId()
  const participantA = randomId()
  const participantB = randomId()
  const participantC = randomId()

  const receiptId = randomId()
  const foreignReceiptId = randomId()

  const pizzaId = randomId()
  const taxId = randomId()
  const foreignItemId = randomId()

  beforeAll(async () => {
    await prisma.group.create({
      data: {
        id: groupId,
        name: 'Receipt mutations Group',
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

    await prisma.receipt.create({
      data: {
        id: receiptId,
        groupId,
        imageUrl: `https://example.com/${randomId()}.jpg`,
        status: ReceiptStatus.EXTRACTED,
      },
    })

    // A separate receipt in the same group, used to prove item ownership.
    await prisma.receipt.create({
      data: {
        id: foreignReceiptId,
        groupId,
        imageUrl: `https://example.com/${randomId()}.jpg`,
        status: ReceiptStatus.EXTRACTED,
        items: {
          create: {
            id: foreignItemId,
            name: 'Foreign',
            quantityMilli: 1000,
            amount: 100,
            isShared: false,
            position: 0,
          },
        },
      },
    })
  })

  beforeEach(async () => {
    // Reset the receipt under test to a known state.
    await prisma.receiptItem.deleteMany({ where: { receiptId } })
    await prisma.receiptOptOut.deleteMany({ where: { receiptId } })

    await prisma.receiptItem.createMany({
      data: [
        {
          id: pizzaId,
          receiptId,
          name: 'Pizza',
          quantityMilli: 3000,
          amount: 900,
          isShared: false,
          position: 0,
        },
        {
          id: taxId,
          receiptId,
          name: 'Tax',
          quantityMilli: 1000,
          amount: 300,
          isShared: true,
          position: 1,
        },
      ],
    })

    // Two of three pizza units assigned; Carol's unit stays unassigned.
    await prisma.receiptItemPortion.createMany({
      data: [
        {
          itemId: pizzaId,
          target: 'PARTICIPANT',
          participantId: participantA,
          quantityMilli: 1000,
        },
        {
          itemId: pizzaId,
          target: 'PARTICIPANT',
          participantId: participantB,
          quantityMilli: 1000,
        },
      ],
    })
  })

  afterAll(async () => {
    await prisma.group.delete({ where: { id: groupId } })
  })

  function shareFor(split: ReceiptSplitResult, participantId: string) {
    return split.participants.find(
      (share) => share.participantId === participantId,
    )!
  }

  it('replaces an item’s portions and returns a split reflecting them', async () => {
    const { split } = await caller.receipts.setItemPortions({
      groupId,
      receiptId,
      itemId: pizzaId,
      portions: [
        {
          target: 'PARTICIPANT',
          participantId: participantA,
          quantityMilli: 3000,
        },
      ],
    })

    const portions = await prisma.receiptItemPortion.findMany({
      where: { itemId: pizzaId },
    })
    expect(portions).toHaveLength(1)
    expect(portions[0]).toMatchObject({
      target: 'PARTICIPANT',
      participantId: participantA,
      quantityMilli: 3000,
    })

    expect(split.itemsTotal).toBe(1200)
    expect(split.sharedPool).toBe(300)
    expect(split.unassignedPool).toBe(0)
    expect(shareFor(split, participantA).direct).toBe(900)
    expect(shareFor(split, participantB).direct).toBe(0)
    expect(shareFor(split, participantC).direct).toBe(0)
  })

  it('flips a shared item out of the shared pool when assigned to participants', async () => {
    const { split } = await caller.receipts.setItemPortions({
      groupId,
      receiptId,
      itemId: taxId,
      portions: [
        {
          target: 'PARTICIPANT',
          participantId: participantA,
          quantityMilli: 1000,
        },
      ],
    })

    const tax = await prisma.receiptItem.findUnique({ where: { id: taxId } })
    expect(tax?.isShared).toBe(false)

    expect(split.sharedPool).toBe(0)
    expect(shareFor(split, participantA).direct).toBe(600)
    expect(shareFor(split, participantB).direct).toBe(300)
    expect(shareFor(split, participantA).shared).toBe(0)
    expect(shareFor(split, participantA).total).toBe(700)
  })

  it('keeps isShared true when every portion is SHARED', async () => {
    await caller.receipts.setItemPortions({
      groupId,
      receiptId,
      itemId: taxId,
      portions: [{ target: 'SHARED', quantityMilli: 1000 }],
    })

    const tax = await prisma.receiptItem.findUnique({ where: { id: taxId } })
    expect(tax?.isShared).toBe(true)
  })

  it('rejects portions that exceed the item quantity', async () => {
    await expect(
      caller.receipts.setItemPortions({
        groupId,
        receiptId,
        itemId: pizzaId,
        portions: [
          {
            target: 'PARTICIPANT',
            participantId: participantA,
            quantityMilli: 4001,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    // The stored portions are untouched by the rejected call.
    const portions = await prisma.receiptItemPortion.findMany({
      where: { itemId: pizzaId },
    })
    expect(portions).toHaveLength(2)
  })

  it('adds an item and grows the split', async () => {
    const { split } = await caller.receipts.addItem({
      groupId,
      receiptId,
      name: 'Salad',
      quantityMilli: 1000,
      amount: 1000,
      isShared: false,
    })

    expect(split.itemsTotal).toBe(2200)

    const stored = await prisma.receiptItem.findFirst({
      where: { receiptId, name: 'Salad' },
    })
    expect(stored).not.toBeNull()
    expect(stored?.position).toBe(2)
    expect(stored?.isShared).toBe(false)
    expect(stored?.amount).toBe(1000)
  })

  it('updates only the provided item fields and reflects them in the split', async () => {
    const { split } = await caller.receipts.updateItem({
      groupId,
      receiptId,
      itemId: pizzaId,
      amount: 1200,
    })

    expect(split.itemsTotal).toBe(1500)

    const pizza = await prisma.receiptItem.findUnique({
      where: { id: pizzaId },
    })
    expect(pizza?.amount).toBe(1200)
    // Untouched fields keep their values.
    expect(pizza?.name).toBe('Pizza')
    expect(pizza?.quantityMilli).toBe(3000)
    expect(pizza?.isShared).toBe(false)
  })

  it('deletes an item and shrinks the split', async () => {
    const { split } = await caller.receipts.deleteItem({
      groupId,
      receiptId,
      itemId: taxId,
    })

    expect(split.itemsTotal).toBe(900)
    expect(split.sharedPool).toBe(0)
    expect(
      await prisma.receiptItem.findUnique({ where: { id: taxId } }),
    ).toBeNull()
  })

  it('excludes an opted-out participant from the unassigned pool but not the shared pool, and restores them', async () => {
    const optedOut = await caller.receipts.setOptOut({
      groupId,
      receiptId,
      participantId: participantC,
      optedOut: true,
    })

    const carolOut = shareFor(optedOut.split, participantC)
    expect(carolOut.unassigned).toBe(0)
    // SHARED charges still apply to opted-out participants.
    expect(carolOut.shared).toBe(100)
    expect(shareFor(optedOut.split, participantA).unassigned).toBe(150)
    expect(shareFor(optedOut.split, participantB).unassigned).toBe(150)

    expect(
      await prisma.receiptOptOut.count({
        where: { receiptId, participantId: participantC },
      }),
    ).toBe(1)

    const restored = await caller.receipts.setOptOut({
      groupId,
      receiptId,
      participantId: participantC,
      optedOut: false,
    })

    expect(shareFor(restored.split, participantC).unassigned).toBe(100)
    expect(
      await prisma.receiptOptOut.count({
        where: { receiptId, participantId: participantC },
      }),
    ).toBe(0)
  })

  it('rejects an itemId that belongs to another receipt', async () => {
    await expect(
      caller.receipts.deleteItem({
        groupId,
        receiptId,
        itemId: foreignItemId,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await expect(
      caller.receipts.updateItem({
        groupId,
        receiptId,
        itemId: foreignItemId,
        amount: 5,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await expect(
      caller.receipts.setItemPortions({
        groupId,
        receiptId,
        itemId: foreignItemId,
        portions: [],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects a participant that is not in the group', async () => {
    const outsider = randomId()

    await expect(
      caller.receipts.setOptOut({
        groupId,
        receiptId,
        participantId: outsider,
        optedOut: true,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    await expect(
      caller.receipts.setItemPortions({
        groupId,
        receiptId,
        itemId: pizzaId,
        portions: [
          {
            target: 'PARTICIPANT',
            participantId: outsider,
            quantityMilli: 100,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})
