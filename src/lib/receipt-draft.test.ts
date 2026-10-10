import {
  addItem,
  buildReceiptSections,
  computeDraftSplit,
  deleteItem,
  draftFromReceipt,
  itemAssignedQuantity,
  itemRemainingQuantity,
  receiptApplyBlocker,
  reconcileDraft,
  removePortion,
  setItemPortions,
  setOptOut,
  splitItemEqually,
  updateItem,
  type DraftItem,
  type DraftPortion,
  type ReceiptDraft,
} from './receipt-draft'

function makeItem(overrides: Partial<DraftItem> & { id: string }): DraftItem {
  return {
    name: 'Item',
    quantityMilli: 1000,
    unitPrice: null,
    amount: 1000,
    isShared: false,
    isAdjustment: false,
    position: 0,
    portions: [],
    ...overrides,
  }
}

function makeDraft(overrides: Partial<ReceiptDraft> = {}): ReceiptDraft {
  return {
    items: [],
    optedOutParticipantIds: [],
    printedTotal: null,
    ...overrides,
  }
}

function participantPortion(
  participantId: string,
  quantityMilli: number,
): DraftPortion {
  return { target: 'PARTICIPANT', participantId, quantityMilli }
}

function sharedPortion(quantityMilli: number): DraftPortion {
  return { target: 'SHARED', participantId: null, quantityMilli }
}

function itemById(draft: ReceiptDraft, id: string): DraftItem {
  return draft.items.find((item) => item.id === id)!
}

function sectionFor(
  sections: ReturnType<typeof buildReceiptSections>,
  id: string,
) {
  return sections.byParticipant.find((section) => section.participantId === id)!
}

describe('draftFromReceipt', () => {
  it('copies fields and sorts items by position', () => {
    const draft = draftFromReceipt({
      total: 2500,
      optOuts: [{ participantId: 'p2' }],
      items: [
        {
          id: 'b',
          name: 'Second',
          quantityMilli: 2000,
          unitPrice: 500,
          amount: 1000,
          isShared: false,
          isAdjustment: false,
          position: 2,
          portions: [participantPortion('p1', 2000)],
        },
        {
          id: 'a',
          name: 'First',
          quantityMilli: 1000,
          unitPrice: null,
          amount: 1500,
          isShared: true,
          isAdjustment: true,
          position: 1,
          portions: [sharedPortion(1000)],
        },
      ],
    })

    expect(draft.printedTotal).toBe(2500)
    expect(draft.optedOutParticipantIds).toEqual(['p2'])
    expect(draft.items.map((item) => item.id)).toEqual(['a', 'b'])
    expect(draft.items[1].unitPrice).toBe(500)
    expect(draft.items[0].isAdjustment).toBe(true)
    expect(draft.items[0].portions).toEqual([sharedPortion(1000)])
  })

  it('deep-copies so mutating the draft never touches the input', () => {
    const input = {
      total: 1000,
      optOuts: [{ participantId: 'p1' }],
      items: [
        {
          id: 'a',
          name: 'A',
          quantityMilli: 1000,
          unitPrice: 100,
          amount: 1000,
          isShared: false,
          isAdjustment: false,
          position: 0,
          portions: [{ ...participantPortion('p1', 1000) }],
        },
      ],
    }

    const draft = draftFromReceipt(input)
    draft.items[0].name = 'Changed'
    draft.items[0].portions.push(sharedPortion(1))
    draft.items[0].portions[0].quantityMilli = 5
    draft.optedOutParticipantIds.push('p2')

    expect(input.items[0].name).toBe('A')
    expect(input.items[0].portions).toHaveLength(1)
    expect(input.items[0].portions[0].quantityMilli).toBe(1000)
    expect(input.optOuts).toEqual([{ participantId: 'p1' }])
  })
})

describe('setItemPortions', () => {
  it('clamps quantities to the item quantity in order and drops zeros', () => {
    const draft = makeDraft({
      items: [makeItem({ id: 'i', quantityMilli: 1000 })],
    })
    const next = setItemPortions(draft, 'i', [
      participantPortion('p1', 700),
      participantPortion('p2', 700),
      participantPortion('p3', 500),
    ])

    expect(itemById(next, 'i').portions).toEqual([
      participantPortion('p1', 700),
      participantPortion('p2', 300),
    ])
    // The input draft is untouched.
    expect(itemById(draft, 'i').portions).toEqual([])
  })

  it('forces SHARED participantId to null and drops participant-less PARTICIPANT portions', () => {
    const draft = makeDraft({
      items: [makeItem({ id: 'i', quantityMilli: 1000 })],
    })
    const next = setItemPortions(draft, 'i', [
      { target: 'PARTICIPANT', participantId: null, quantityMilli: 300 },
      { target: 'SHARED', participantId: 'ignored', quantityMilli: 400 },
      participantPortion('p1', 0),
    ])

    expect(itemById(next, 'i').portions).toEqual([sharedPortion(400)])
  })

  it('is a no-op for an unknown item id', () => {
    const draft = makeDraft({ items: [makeItem({ id: 'i' })] })
    expect(setItemPortions(draft, 'nope', [])).toEqual(draft)
  })
})

describe('splitItemEqually', () => {
  it('splits 1000 three ways, leaving nothing unassigned', () => {
    const draft = makeDraft({
      items: [makeItem({ id: 'i', quantityMilli: 1000, amount: 1000 })],
    })
    const next = splitItemEqually(draft, 'i', ['p1', 'p2', 'p3'])
    const item = itemById(next, 'i')

    expect(item.portions.map((portion) => portion.quantityMilli)).toEqual([
      334, 333, 333,
    ])
    expect(
      item.portions.every((portion) => portion.target === 'PARTICIPANT'),
    ).toBe(true)
    expect(itemAssignedQuantity(item)).toBe(1000)
    expect(itemRemainingQuantity(item)).toBe(0)

    const split = computeDraftSplit(next, ['p1', 'p2', 'p3'])
    expect(split.unassignedPool).toBe(0)
    expect(
      split.participants.reduce((sum, share) => sum + share.total, 0),
    ).toBe(1000)
  })
})

describe('removePortion', () => {
  it('removePortion returns the freed quantity to the unassigned pool', () => {
    const draft = makeDraft({
      items: [
        makeItem({
          id: 'i',
          quantityMilli: 1000,
          amount: 1000,
          portions: [
            participantPortion('p1', 600),
            participantPortion('p2', 400),
          ],
        }),
      ],
    })
    const next = removePortion(draft, 'i', 0)

    expect(itemById(next, 'i').portions).toEqual([
      participantPortion('p2', 400),
    ])
    expect(itemRemainingQuantity(itemById(next, 'i'))).toBe(600)
    expect(computeDraftSplit(next, ['p1', 'p2']).unassignedPool).toBe(600)
  })
})

describe('setOptOut', () => {
  it('excludes the unassigned pool but keeps the shared pool', () => {
    const draft = makeDraft({
      items: [
        makeItem({ id: 'unassigned', quantityMilli: 1000, amount: 1000 }),
        makeItem({
          id: 'shared',
          quantityMilli: 500,
          amount: 500,
          portions: [sharedPortion(500)],
        }),
      ],
    })

    const optedOut = setOptOut(draft, 'p1', true)
    expect(optedOut.optedOutParticipantIds).toEqual(['p1'])

    const split = computeDraftSplit(optedOut, ['p1', 'p2'])
    const p1 = split.participants.find((share) => share.participantId === 'p1')!
    expect(p1.unassigned).toBe(0)
    expect(p1.shared).toBe(250)
    expect(p1.total).toBe(250)
    expect(
      split.participants.reduce((sum, share) => sum + share.total, 0),
    ).toBe(1500)

    expect(setOptOut(optedOut, 'p1', false).optedOutParticipantIds).toEqual([])
  })
})

describe('updateItem / addItem / deleteItem', () => {
  it('re-clamps portions when the quantity shrinks', () => {
    const draft = makeDraft({
      items: [
        makeItem({
          id: 'i',
          quantityMilli: 1000,
          portions: [
            participantPortion('p1', 600),
            participantPortion('p2', 400),
          ],
        }),
      ],
    })
    const next = updateItem(draft, 'i', { quantityMilli: 500, name: 'Renamed' })
    const item = itemById(next, 'i')

    expect(item.name).toBe('Renamed')
    expect(item.quantityMilli).toBe(500)
    expect(item.portions).toEqual([participantPortion('p1', 500)])
  })

  it('adds and deletes items', () => {
    const draft = makeDraft({
      items: [
        makeItem({ id: 'a', position: 0 }),
        makeItem({ id: 'b', position: 5 }),
      ],
    })

    const added = addItem(draft, {
      id: 'c',
      name: 'New',
      quantityMilli: 2000,
      amount: 300,
      isShared: true,
    })
    const item = itemById(added, 'c')
    expect(item.position).toBe(6)
    expect(item.unitPrice).toBeNull()
    expect(item.isAdjustment).toBe(false)
    expect(item.portions).toEqual([])

    const deleted = deleteItem(added, 'a')
    expect(deleted.items.map((existing) => existing.id)).toEqual(['b', 'c'])
  })
})

describe('buildReceiptSections', () => {
  it('lists a fraction in each participant’s section with a remainder unassigned', () => {
    const draft = makeDraft({
      items: [
        makeItem({
          id: 'i',
          quantityMilli: 1000,
          amount: 2000,
          portions: [
            participantPortion('p1', 500),
            participantPortion('p2', 300),
          ],
        }),
      ],
    })

    const sections = buildReceiptSections(draft, ['p1', 'p2'])
    expect(
      sectionFor(sections, 'p1').entries.map((entry) => entry.quantityMilli),
    ).toEqual([500])
    expect(
      sectionFor(sections, 'p2').entries.map((entry) => entry.quantityMilli),
    ).toEqual([300])
    expect(sectionFor(sections, 'p1').entries[0].item.id).toBe('i')
    expect(sections.unassigned.map((entry) => entry.quantityMilli)).toEqual([
      200,
    ])
    expect(sections.shared).toEqual([])
  })

  it('lists a fully shared item under shared', () => {
    const draft = makeDraft({
      items: [
        makeItem({
          id: 'tax',
          quantityMilli: 1000,
          amount: 500,
          isShared: true,
        }),
      ],
    })

    const sections = buildReceiptSections(draft, ['p1', 'p2'])
    expect(sections.shared.map((entry) => entry.item.id)).toEqual(['tax'])
    expect(sections.shared[0].quantityMilli).toBe(1000)
    expect(sections.unassigned).toEqual([])
    expect(
      sections.byParticipant.every((section) => section.entries.length === 0),
    ).toBe(true)
  })

  it('includes every participant id in the given order, even with no entries', () => {
    const draft = makeDraft({ items: [] })
    const sections = buildReceiptSections(draft, ['p3', 'p1', 'p2'])

    expect(
      sections.byParticipant.map((section) => section.participantId),
    ).toEqual(['p3', 'p1', 'p2'])
    expect(
      sections.byParticipant.every((section) => section.entries.length === 0),
    ).toBe(true)
  })
})

describe('reconcileDraft', () => {
  it('reports a positive delta when the printed total is higher', () => {
    const draft = makeDraft({
      printedTotal: 2000,
      items: [makeItem({ id: 'a', amount: 1500 })],
    })
    expect(reconcileDraft(draft)).toEqual({
      printedTotal: 2000,
      itemsTotal: 1500,
      delta: 500,
    })
  })

  it('reports a negative delta when the items exceed the printed total', () => {
    const draft = makeDraft({
      printedTotal: 1000,
      items: [makeItem({ id: 'a', amount: 1500 })],
    })
    expect(reconcileDraft(draft).delta).toBe(-500)
  })

  it('reports a zero delta without a printed total', () => {
    const draft = makeDraft({ items: [makeItem({ id: 'a', amount: 1500 })] })
    expect(reconcileDraft(draft)).toEqual({
      printedTotal: null,
      itemsTotal: 1500,
      delta: 0,
    })
  })
})

describe('receiptApplyBlocker', () => {
  it('blocks only when everyone opted out with a non-empty unassigned pool', () => {
    const base = makeDraft({
      items: [makeItem({ id: 'i', quantityMilli: 1000, amount: 1000 })],
    })
    expect(receiptApplyBlocker(base, ['p1', 'p2'])).toBeNull()

    const allOut = setOptOut(setOptOut(base, 'p1', true), 'p2', true)
    expect(receiptApplyBlocker(allOut, ['p1', 'p2'])).toBe('ALL_OPTED_OUT')

    const assigned = setItemPortions(allOut, 'i', [
      participantPortion('p1', 1000),
    ])
    expect(receiptApplyBlocker(assigned, ['p1', 'p2'])).toBeNull()
  })

  it('blocks when the items total is zero', () => {
    expect(receiptApplyBlocker(makeDraft(), ['p1', 'p2'])).toBe('EMPTY')

    const zeroAmount = makeDraft({
      items: [makeItem({ id: 'i', amount: 0 })],
    })
    expect(receiptApplyBlocker(zeroAmount, ['p1', 'p2'])).toBe('EMPTY')
  })

  it('blocks a negative participant total the BY_AMOUNT split cannot represent', () => {
    // A 10.00 dish assigned to p1 plus a 15.00 whole-bill discount pushes p2
    // below zero (the discount is shared by everyone). The server refuses this
    // state, so the UI must block Apply too.
    const draft = makeDraft({
      items: [
        makeItem({
          id: 'dish',
          quantityMilli: 1000,
          amount: 1000,
          portions: [participantPortion('p1', 1000)],
        }),
        makeItem({
          id: 'discount',
          quantityMilli: 1000,
          amount: -1500,
          isShared: true,
          isAdjustment: true,
        }),
      ],
    })

    const split = computeDraftSplit(draft, ['p1', 'p2'])
    expect(split.participants.some((share) => share.total < 0)).toBe(true)

    expect(receiptApplyBlocker(draft, ['p1', 'p2'])).toBe('NEGATIVE_SHARE')
  })

  it('allows a positive adjustment that keeps every total non-negative', () => {
    const draft = makeDraft({
      items: [
        makeItem({ id: 'dish', quantityMilli: 1000, amount: 1000 }),
        makeItem({
          id: 'tip',
          quantityMilli: 1000,
          amount: 200,
          isShared: true,
          isAdjustment: true,
        }),
      ],
    })

    expect(receiptApplyBlocker(draft, ['p1', 'p2'])).toBeNull()
  })
})
