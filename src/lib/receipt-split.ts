import { weightedApportion, distributeAmount } from '@/lib/shares'
import { RECEIPT_PORTION_TARGETS, type ReceiptPortionTarget } from '@/lib/enums'

export { RECEIPT_PORTION_TARGETS }
export type { ReceiptPortionTarget }

export type ReceiptPortion = {
  target: ReceiptPortionTarget
  /** Required when target === 'PARTICIPANT', ignored for 'SHARED'. */
  participantId?: string | null
  quantityMilli: number
}

export type ReceiptSplitItem = {
  /** Line total in minor units. */
  amount: number
  /** Quantity in thousandths. */
  quantityMilli: number
  portions: ReceiptPortion[]
}

export type ReceiptSplitInput = {
  /** All participants, in the order the UI wants them back. */
  participantIds: string[]
  /** Subset of participants who opted out of the unassigned pool. */
  optedOutParticipantIds: string[]
  items: ReceiptSplitItem[]
}

export type ParticipantReceiptShare = {
  participantId: string
  /** Amount from portions explicitly assigned to this participant. */
  direct: number
  /** Equal share of the shared pool (whole-bill charges). Applies to everyone. */
  shared: number
  /** Equal share of the unassigned pool; 0 when opted out. */
  unassigned: number
  /** direct + shared + unassigned. */
  total: number
}

export type ReceiptSplitResult = {
  /** One entry per participant, in the input order. */
  participants: ParticipantReceiptShare[]
  /** Sum of all item amounts. */
  itemsTotal: number
  sharedPool: number
  unassignedPool: number
  /**
   * True when there is an unassigned pool but no participant shares it
   * (i.e. every participant opted out), which must block Apply.
   */
  allOptedOut: boolean
}

type PartDestination =
  | { kind: 'direct'; participantId: string }
  | { kind: 'shared' }
  | { kind: 'unassigned' }

/**
 * Splits a receipt's line items across participants.
 *
 * Each item's line total is apportioned over the quantities its portions claim
 * (largest remainder, so cents are never lost). Quantities are measured in
 * thousandths; a portion's quantity is clamped to the item's own quantity, and
 * whatever is left over becomes an unassigned pool shared by participants who
 * did not opt out. Shared portions (e.g. a whole-bill tax) are spread over
 * every participant, opt-outs included.
 */
export function computeReceiptSplit(
  input: ReceiptSplitInput,
): ReceiptSplitResult {
  const participants = Array.from(new Set(input.participantIds))
  const participantSet = new Set(participants)
  const optedOut = new Set(
    input.optedOutParticipantIds.filter((id) => participantSet.has(id)),
  )

  const direct = new Map<string, number>()
  let sharedPool = 0
  let unassignedPool = 0

  for (const item of input.items) {
    // A zero, negative or NaN quantity still consumes one whole unit.
    const total = Math.max(Math.trunc(item.quantityMilli) || 0, 1)

    const destinations: PartDestination[] = []
    const weights: number[] = []
    let remaining = total
    let sharedWeight = 0

    for (const portion of item.portions) {
      const quantity = Math.floor(portion.quantityMilli)
      if (!(quantity > 0)) continue
      if (portion.target === 'PARTICIPANT') {
        const participantId = portion.participantId
        if (!participantId || !participantSet.has(participantId)) continue
        const allowed = Math.min(quantity, remaining)
        if (allowed <= 0) continue
        remaining -= allowed
        weights.push(allowed)
        destinations.push({ kind: 'direct', participantId })
      } else {
        const allowed = Math.min(quantity, remaining)
        if (allowed <= 0) continue
        remaining -= allowed
        sharedWeight += allowed
      }
    }

    if (sharedWeight > 0) {
      weights.push(sharedWeight)
      destinations.push({ kind: 'shared' })
    }
    if (remaining > 0) {
      weights.push(remaining)
      destinations.push({ kind: 'unassigned' })
    }

    const amounts = weightedApportion(item.amount, weights)
    destinations.forEach((destination, index) => {
      const amount = amounts[index]
      if (destination.kind === 'direct') {
        direct.set(
          destination.participantId,
          (direct.get(destination.participantId) ?? 0) + amount,
        )
      } else if (destination.kind === 'shared') {
        sharedPool += amount
      } else {
        unassignedPool += amount
      }
    })
  }

  // Shared charges land on everyone, opt-outs included.
  const sharedShares = distributeAmount(sharedPool, participants.length)
  const sharers = participants.filter((id) => !optedOut.has(id))
  const unassignedShares = distributeAmount(unassignedPool, sharers.length)
  const sharerIndex = new Map(
    sharers.map((participantId, index) => [participantId, index]),
  )

  const participantShares = participants.map(
    (participantId, index): ParticipantReceiptShare => {
      const directAmount = direct.get(participantId) ?? 0
      const shared = sharedShares[index] ?? 0
      let unassigned = 0
      if (!optedOut.has(participantId)) {
        unassigned = unassignedShares[sharerIndex.get(participantId) ?? -1] ?? 0
      }
      return {
        participantId,
        direct: directAmount,
        shared,
        unassigned,
        total: directAmount + shared + unassigned,
      }
    },
  )

  return {
    participants: participantShares,
    itemsTotal: input.items.reduce((sum, item) => sum + item.amount, 0),
    sharedPool,
    unassignedPool,
    allOptedOut: sharers.length === 0 && unassignedPool !== 0,
  }
}
