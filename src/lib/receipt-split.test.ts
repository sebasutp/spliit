import {
  ReceiptPortion,
  ReceiptSplitInput,
  computeReceiptSplit,
  toReceiptSplitItems,
  type StoredReceiptItem,
} from './receipt-split'

/** Local helper: a PARTICIPANT portion assigned to a participant. */
function forParticipant(
  participantId: string,
  quantityMilli: number,
): ReceiptPortion {
  return { target: 'PARTICIPANT', participantId, quantityMilli }
}

/** Local helper: a SHARED portion (a whole-bill charge). */
function shared(quantityMilli: number): ReceiptPortion {
  return { target: 'SHARED', quantityMilli }
}

function byId(result: ReturnType<typeof computeReceiptSplit>, id: string) {
  return result.participants.find((share) => share.participantId === id)!
}

function total(result: ReturnType<typeof computeReceiptSplit>) {
  return result.participants.reduce((sum, share) => sum + share.total, 0)
}

describe('computeReceiptSplit', () => {
  it('splits an unassigned item evenly without losing a cent', () => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2', 'p3'],
      optedOutParticipantIds: [],
      items: [{ amount: 1000, quantityMilli: 1000, portions: [] }],
    })

    expect(
      result.participants.map((share) => share.total).sort((a, b) => a - b),
    ).toEqual([333, 333, 334])
    expect(total(result)).toBe(1000)
  })

  it('splits a 0.5 / 0.5 item 1000 / 1000', () => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2'],
      optedOutParticipantIds: [],
      items: [
        {
          amount: 2000,
          quantityMilli: 1000,
          portions: [forParticipant('p1', 500), forParticipant('p2', 500)],
        },
      ],
    })

    expect(byId(result, 'p1').total).toBe(1000)
    expect(byId(result, 'p2').total).toBe(1000)
  })

  it('assigns "2 of the 3 beers" 2000 / 1000', () => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2'],
      optedOutParticipantIds: [],
      items: [
        {
          amount: 3000,
          quantityMilli: 3000,
          portions: [forParticipant('p1', 2000), forParticipant('p2', 1000)],
        },
      ],
    })

    expect(byId(result, 'p1').direct).toBe(2000)
    expect(byId(result, 'p2').direct).toBe(1000)
  })

  it('aggregates repeated items assigned to different people', () => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2'],
      optedOutParticipantIds: [],
      items: [
        {
          amount: 500,
          quantityMilli: 1000,
          portions: [forParticipant('p1', 1000)],
        },
        {
          amount: 700,
          quantityMilli: 1000,
          portions: [forParticipant('p1', 1000)],
        },
        {
          amount: 300,
          quantityMilli: 1000,
          portions: [forParticipant('p2', 1000)],
        },
      ],
    })

    expect(byId(result, 'p1').direct).toBe(1200)
    expect(byId(result, 'p2').direct).toBe(300)
    expect(total(result)).toBe(1500)
  })

  it('does not charge an opted-out participant for the unassigned pool but does charge them SHARED items', () => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2', 'p3'],
      optedOutParticipantIds: ['p1'],
      items: [
        // Unassigned: goes to the sharers only.
        { amount: 900, quantityMilli: 1000, portions: [] },
        // SHARED tax: goes to everyone, opt-out included.
        {
          amount: 300,
          quantityMilli: 1000,
          portions: [shared(1000)],
        },
      ],
    })

    expect(byId(result, 'p1').unassigned).toBe(0)
    expect(byId(result, 'p1').shared).toBe(100)
    expect(byId(result, 'p1').total).toBe(100)
    expect(byId(result, 'p2').total).toBe(550)
    expect(byId(result, 'p3').total).toBe(550)
    expect(total(result)).toBe(1200)
  })

  it('returns a removed portion’s quantity to the unassigned pool', () => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2', 'p3'],
      optedOutParticipantIds: [],
      items: [
        {
          amount: 1000,
          quantityMilli: 1000,
          portions: [forParticipant('p1', 500)],
        },
      ],
    })

    expect(byId(result, 'p1').direct).toBe(500)
    expect(result.unassignedPool).toBe(500)
    expect(total(result)).toBe(1000)
  })

  it('loses nothing when three people each claim 1/3 of a 1000 item', () => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2', 'p3'],
      optedOutParticipantIds: [],
      items: [
        {
          amount: 1000,
          quantityMilli: 1000,
          portions: [
            forParticipant('p1', 333),
            forParticipant('p2', 333),
            forParticipant('p3', 333),
          ],
        },
      ],
    })

    expect(result.participants.map((share) => share.total)).toEqual([
      334, 333, 333,
    ])
    expect(total(result)).toBe(1000)
  })

  it('keeps the invariant on deterministic pseudo-random inputs', () => {
    let seed = 42
    const random = () => {
      // Deterministic LCG so the test is reproducible.
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }

    for (let round = 0; round < 25; round++) {
      const participantCount = 1 + Math.floor(random() * 4)
      const participantIds = Array.from(
        { length: participantCount },
        (_, index) => `p${index}`,
      )
      // Keep at least one sharer: the invariant is stated for the case where
      // the unassigned pool has someone to land on (all-opted-out is blocked
      // separately via `allOptedOut`).
      const optedOutParticipantIds = participantIds
        .slice(1)
        .filter(() => random() < 0.3)

      const items = Array.from({ length: 1 + Math.floor(random() * 4) }, () => {
        const quantityMilli = 1 + Math.floor(random() * 4000)
        const portions: ReceiptPortion[] = []
        const portionCount = Math.floor(random() * 4)
        for (let index = 0; index < portionCount; index++) {
          if (random() < 0.25) {
            portions.push(shared(1 + Math.floor(random() * quantityMilli)))
          } else {
            portions.push(
              forParticipant(
                participantIds[Math.floor(random() * participantCount)],
                1 + Math.floor(random() * quantityMilli),
              ),
            )
          }
        }
        return {
          amount: Math.floor(random() * 5000),
          quantityMilli,
          portions,
        }
      })

      const input: ReceiptSplitInput = {
        participantIds,
        optedOutParticipantIds,
        items,
      }
      const result = computeReceiptSplit(input)

      expect(total(result)).toBe(result.itemsTotal)
    }
  })

  it('flags all-opted-out when there is an unassigned pool nobody will take', () => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2'],
      optedOutParticipantIds: ['p1', 'p2'],
      items: [{ amount: 1000, quantityMilli: 1000, portions: [] }],
    })

    expect(result.allOptedOut).toBe(true)
  })

  it('does not flag all-opted-out when everything is explicitly assigned', () => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2'],
      optedOutParticipantIds: ['p1', 'p2'],
      items: [
        {
          amount: 1000,
          quantityMilli: 1000,
          portions: [forParticipant('p1', 500), forParticipant('p2', 500)],
        },
      ],
    })

    expect(result.unassignedPool).toBe(0)
    expect(result.allOptedOut).toBe(false)
  })

  it('clamps portions that exceed the item quantity', () => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2'],
      optedOutParticipantIds: [],
      items: [
        {
          amount: 1000,
          quantityMilli: 1000,
          portions: [forParticipant('p1', 800), forParticipant('p2', 800)],
        },
      ],
    })

    expect(byId(result, 'p1').direct).toBe(800)
    expect(byId(result, 'p2').direct).toBe(200)
    expect(result.unassignedPool).toBe(0)
    expect(total(result)).toBe(1000)
  })

  it('ignores a portion for an unknown participant', () => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2'],
      optedOutParticipantIds: [],
      items: [
        {
          amount: 1000,
          quantityMilli: 1000,
          portions: [forParticipant('ghost', 500), forParticipant('p1', 500)],
        },
      ],
    })

    expect(result.participants).toHaveLength(2)
    expect(
      result.participants.some((share) => share.participantId === 'ghost'),
    ).toBe(false)
    // The ghost portion returns to the unassigned pool, split over p1 and p2.
    expect(byId(result, 'p1').direct).toBe(500)
    expect(result.unassignedPool).toBe(500)
    expect(total(result)).toBe(1000)
  })

  it('spreads SHARED portions over everyone', () => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2', 'p3'],
      optedOutParticipantIds: [],
      items: [
        {
          amount: 300,
          quantityMilli: 1000,
          portions: [shared(1000)],
        },
      ],
    })

    for (const share of result.participants) {
      expect(share.shared).toBe(100)
    }
    expect(result.sharedPool).toBe(300)
  })

  it('de-duplicates participants while preserving order', () => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2', 'p1'],
      optedOutParticipantIds: [],
      items: [{ amount: 100, quantityMilli: 1000, portions: [] }],
    })

    expect(result.participants.map((share) => share.participantId)).toEqual([
      'p1',
      'p2',
    ])
  })

  it('ignores opted-out ids that are not participants', () => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2'],
      optedOutParticipantIds: ['ghost'],
      items: [{ amount: 100, quantityMilli: 1000, portions: [] }],
    })

    expect(result.allOptedOut).toBe(false)
    expect(total(result)).toBe(100)
  })

  it('handles an item with no participants at all', () => {
    const result = computeReceiptSplit({
      participantIds: [],
      optedOutParticipantIds: [],
      items: [{ amount: 500, quantityMilli: 1000, portions: [] }],
    })

    expect(result.participants).toEqual([])
    expect(result.itemsTotal).toBe(500)
  })

  it('still charges an opted-out participant their direct amount and SHARED share, but not the unassigned pool', () => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2', 'p3'],
      optedOutParticipantIds: ['p1'],
      items: [
        // Explicitly assigned to the opted-out participant: still theirs.
        {
          amount: 1000,
          quantityMilli: 1000,
          portions: [forParticipant('p1', 1000)],
        },
        // SHARED tax: spread over everyone, opt-out included.
        {
          amount: 300,
          quantityMilli: 1000,
          portions: [shared(1000)],
        },
        // Unassigned: only the sharers split it.
        { amount: 900, quantityMilli: 1000, portions: [] },
      ],
    })

    expect(byId(result, 'p1').direct).toBe(1000)
    expect(byId(result, 'p1').shared).toBe(100)
    expect(byId(result, 'p1').unassigned).toBe(0)
    expect(byId(result, 'p1').total).toBe(1100)
    expect(byId(result, 'p2').unassigned).toBe(450)
    expect(byId(result, 'p3').unassigned).toBe(450)
    expect(total(result)).toBe(2200)
  })

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['NaN', NaN],
  ])(
    'treats a %s item quantityMilli as quantity 1',
    (_label, quantityMilli) => {
      const result = computeReceiptSplit({
        participantIds: ['p1', 'p2'],
        optedOutParticipantIds: [],
        items: [
          {
            amount: 500,
            quantityMilli,
            portions: [forParticipant('p1', 1)],
          },
        ],
      })

      // Quantity 1, claimed entirely by p1.
      expect(byId(result, 'p1').direct).toBe(500)
      expect(result.unassignedPool).toBe(0)
      expect(total(result)).toBe(result.itemsTotal)
      expect(total(result)).toBe(500)
    },
  )

  it('clamps a SHARED portion whose quantity exceeds the item quantity', () => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2'],
      optedOutParticipantIds: [],
      items: [
        {
          amount: 1000,
          quantityMilli: 1000,
          // Claims 5x the item; must be clamped to the full quantity.
          portions: [shared(5000)],
        },
      ],
    })

    expect(result.sharedPool).toBe(1000)
    expect(result.unassignedPool).toBe(0)
    expect(byId(result, 'p1').shared).toBe(500)
    expect(byId(result, 'p2').shared).toBe(500)
    expect(total(result)).toBe(1000)
  })

  it.each([
    ['zero', 0],
    ['negative', -5],
  ])('ignores a portion with a %s quantityMilli', (_label, quantityMilli) => {
    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2'],
      optedOutParticipantIds: [],
      items: [
        {
          amount: 1000,
          quantityMilli: 1000,
          portions: [
            forParticipant('p1', quantityMilli),
            forParticipant('p2', 1000),
          ],
        },
      ],
    })

    expect(byId(result, 'p1').direct).toBe(0)
    expect(byId(result, 'p2').direct).toBe(1000)
    expect(result.unassignedPool).toBe(0)
    expect(total(result)).toBe(1000)
  })
})

describe('toReceiptSplitItems', () => {
  it('keeps a normal item’s stored portions', () => {
    const stored: StoredReceiptItem[] = [
      {
        amount: 1000,
        quantityMilli: 1000,
        isShared: false,
        portions: [forParticipant('p1', 1000)],
      },
    ]

    expect(toReceiptSplitItems(stored)).toEqual([
      {
        amount: 1000,
        quantityMilli: 1000,
        portions: [
          { target: 'PARTICIPANT', participantId: 'p1', quantityMilli: 1000 },
        ],
      },
    ])
  })

  it('routes a shared item entirely to the shared pool, ignoring stored portions', () => {
    const stored: StoredReceiptItem[] = [
      {
        amount: 500,
        quantityMilli: 1000,
        isShared: true,
        // A whole-bill charge never uses stored per-participant portions.
        portions: [forParticipant('p1', 1000)],
      },
    ]

    expect(toReceiptSplitItems(stored)).toEqual([
      {
        amount: 500,
        quantityMilli: 1000,
        portions: [{ target: 'SHARED', quantityMilli: 1000 }],
      },
    ])

    const result = computeReceiptSplit({
      participantIds: ['p1', 'p2'],
      optedOutParticipantIds: ['p1'],
      items: toReceiptSplitItems(stored),
    })

    // Shared charges land on everyone, opt-outs included.
    expect(byId(result, 'p1').total).toBe(250)
    expect(byId(result, 'p2').total).toBe(250)
    expect(result.sharedPool).toBe(500)
  })
})
