import { ReceiptStatus } from '@/lib/enums'
import { prisma } from '@/lib/prisma'
import { randomId } from '@/lib/random'
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
