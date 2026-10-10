import { ReceiptStatus } from '@/lib/enums'
import { prisma } from '@/lib/prisma'
import { randomId } from '@/lib/random'
import type { NormalizedReceipt } from '@/lib/receipt-extraction'
import {
  completeReceipt,
  createPendingReceipt,
  failReceipt,
  getReceiptById,
  getReceiptByImage,
  getReceiptForExpense,
  linkReceiptToExpense,
} from './receipts'

describe('receipts data access', () => {
  const groupId = randomId()
  const participantA = randomId()
  const participantB = randomId()
  let categoryId: number

  beforeAll(async () => {
    const category = await prisma.category.create({
      data: { grouping: 'Receipt tests', name: `Receipt test ${randomId()}` },
    })
    categoryId = category.id

    await prisma.group.create({
      data: {
        id: groupId,
        name: 'Receipt Test Group',
        participants: {
          createMany: {
            data: [
              { id: participantA, name: 'Alice' },
              { id: participantB, name: 'Bob' },
            ],
          },
        },
      },
    })
  })

  afterAll(async () => {
    // Receipts (and their items/opt-outs) cascade from the group.
    await prisma.group.delete({ where: { id: groupId } })
    await prisma.category.delete({ where: { id: categoryId } })
  })

  it('creates a pending receipt and reads it back by id and image', async () => {
    const imageUrl = `https://example.com/${randomId()}.jpg`

    const created = await createPendingReceipt({
      groupId,
      imageUrl,
      imageWidth: 800,
      imageHeight: 600,
    })

    expect(created.status).toBe(ReceiptStatus.PENDING)
    expect(created.imageWidth).toBe(800)
    expect(created.imageHeight).toBe(600)
    expect(created.items).toEqual([])
    expect(created.optOuts).toEqual([])

    const byId = await getReceiptById(created.id)
    expect(byId?.id).toBe(created.id)
    expect(byId?.status).toBe(ReceiptStatus.PENDING)

    const byImage = await getReceiptByImage(groupId, imageUrl)
    expect(byImage?.id).toBe(created.id)
  })

  it('returns the existing receipt when the same (groupId, imageUrl) is created twice', async () => {
    const imageUrl = `https://example.com/${randomId()}.jpg`

    const first = await createPendingReceipt({ groupId, imageUrl })
    const second = await createPendingReceipt({ groupId, imageUrl })

    expect(second.id).toBe(first.id)

    const count = await prisma.receipt.count({
      where: { groupId, imageUrl },
    })
    expect(count).toBe(1)
  })

  it('completes a receipt, storing header fields and ordered items, and replaces items on re-complete', async () => {
    const imageUrl = `https://example.com/${randomId()}.jpg`
    const receipt = await createPendingReceipt({ groupId, imageUrl })

    const normalized: NormalizedReceipt = {
      merchant: 'Café',
      date: '2026-04-01',
      currencyCode: 'EUR',
      total: 4200,
      categoryId: '7',
      itemsTotal: 4200,
      items: [
        {
          name: 'Coffee',
          quantityMilli: 2000,
          unitPrice: 300,
          amount: 600,
          isShared: false,
          isAdjustment: false,
          position: 0,
        },
        {
          name: 'Cake',
          quantityMilli: 1000,
          unitPrice: 1000,
          amount: 1000,
          isShared: false,
          isAdjustment: false,
          position: 1,
        },
        {
          name: 'Tax',
          quantityMilli: 1000,
          unitPrice: null,
          amount: 400,
          isShared: true,
          isAdjustment: false,
          position: 2,
        },
        {
          name: 'Adjustment',
          quantityMilli: 1000,
          unitPrice: null,
          amount: 2200,
          isShared: true,
          isAdjustment: true,
          position: 3,
        },
      ],
    }

    const completed = await completeReceipt(receipt.id, {
      rawExtraction: '{"raw":true}',
      provider: 'openai',
      model: 'gpt-4o',
      normalized,
    })

    expect(completed.status).toBe(ReceiptStatus.EXTRACTED)
    expect(completed.merchant).toBe('Café')
    expect(completed.currencyCode).toBe('EUR')
    expect(completed.total).toBe(4200)
    expect(completed.receiptDate?.toISOString()).toBe(
      '2026-04-01T12:00:00.000Z',
    )
    expect(completed.rawExtraction).toBe('{"raw":true}')
    expect(completed.provider).toBe('openai')
    expect(completed.model).toBe('gpt-4o')

    expect(completed.items.map((item) => item.name)).toEqual([
      'Coffee',
      'Cake',
      'Tax',
      'Adjustment',
    ])
    expect(completed.items.map((item) => item.position)).toEqual([0, 1, 2, 3])

    const tax = completed.items.find((item) => item.name === 'Tax')!
    expect(tax.isShared).toBe(true)
    expect(tax.isAdjustment).toBe(false)
    expect(tax.amount).toBe(400)

    const adjustment = completed.items.find(
      (item) => item.name === 'Adjustment',
    )!
    expect(adjustment.isShared).toBe(true)
    expect(adjustment.isAdjustment).toBe(true)

    // Completing again replaces the items rather than appending.
    const second = await completeReceipt(receipt.id, {
      rawExtraction: null,
      provider: null,
      model: null,
      normalized: {
        ...normalized,
        total: 600,
        itemsTotal: 600,
        items: [normalized.items[0]],
      },
    })

    expect(second.items).toHaveLength(1)
    expect(second.items[0].name).toBe('Coffee')
    expect(second.items[0].position).toBe(0)

    const stored = await prisma.receiptItem.count({
      where: { receiptId: receipt.id },
    })
    expect(stored).toBe(1)
  })

  it('finds a receipt for an expense only after linking it', async () => {
    const imageUrl = `https://example.com/${randomId()}.jpg`
    const receipt = await createPendingReceipt({ groupId, imageUrl })

    expect(await getReceiptForExpense(groupId, 'does-not-exist')).toBeNull()

    const expense = await prisma.expense.create({
      data: {
        id: randomId(),
        groupId,
        title: 'Dinner',
        amount: 4200,
        paidById: participantA,
        categoryId,
        paidFor: {
          createMany: {
            data: [
              { participantId: participantA, shares: 2100 },
              { participantId: participantB, shares: 2100 },
            ],
          },
        },
      },
    })

    expect(await getReceiptForExpense(groupId, expense.id)).toBeNull()

    await linkReceiptToExpense(receipt.id, expense.id)

    const linked = await getReceiptForExpense(groupId, expense.id)
    expect(linked?.id).toBe(receipt.id)

    // Clearing the link detaches it again.
    await linkReceiptToExpense(receipt.id, null)
    expect(await getReceiptForExpense(groupId, expense.id)).toBeNull()
  })

  it('marks a receipt as failed with the raw/provider/model metadata', async () => {
    const imageUrl = `https://example.com/${randomId()}.jpg`
    const receipt = await createPendingReceipt({ groupId, imageUrl })

    await failReceipt(receipt.id, {
      rawExtraction: 'malformed',
      provider: 'openai',
      model: 'gpt-4o',
    })

    const failed = await getReceiptById(receipt.id)
    expect(failed?.status).toBe(ReceiptStatus.FAILED)
    expect(failed?.rawExtraction).toBe('malformed')
    expect(failed?.provider).toBe('openai')
    expect(failed?.model).toBe('gpt-4o')
  })
})
