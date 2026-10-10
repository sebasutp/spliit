import type { ReceiptPortionTarget } from '@/lib/enums'
import type { ReceiptSplitResult } from '@/lib/receipt-split'
import {
  computeReceiptSplit,
  consumeItemPortions,
  toReceiptSplitItems,
} from '@/lib/receipt-split'
import { distributeAmount } from '@/lib/shares'

export type DraftPortion = {
  target: ReceiptPortionTarget
  participantId: string | null
  quantityMilli: number
}

export type DraftItem = {
  id: string
  name: string
  quantityMilli: number
  unitPrice: number | null
  amount: number
  isShared: boolean
  isAdjustment: boolean
  position: number
  portions: DraftPortion[]
}

export type ReceiptDraft = {
  items: DraftItem[]
  optedOutParticipantIds: string[]
  printedTotal: number | null
}

/** The persisted receipt shape `draftFromReceipt` accepts. */
type ReceiptInput = {
  total: number | null
  items: {
    id: string
    name: string
    quantityMilli: number
    unitPrice: number | null
    amount: number
    isShared: boolean
    isAdjustment: boolean
    position: number
    portions: {
      target: ReceiptPortionTarget
      participantId: string | null
      quantityMilli: number
    }[]
  }[]
  optOuts: { participantId: string }[]
}

/** Floors a quantity to a non-negative integer number of thousandths. */
function toMilli(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(Math.floor(value), 0)
}

/**
 * Clamps one portion to the given remaining budget. Returns null when nothing
 * is left (a non-positive quantity, a SHARED that ran out of budget, or a
 * PARTICIPANT portion without a participant).
 */
function clampPortion(
  portion: DraftPortion,
  budget: number,
): DraftPortion | null {
  const allowed = Math.min(toMilli(portion.quantityMilli), Math.max(budget, 0))
  if (allowed <= 0) return null
  if (portion.target === 'SHARED') {
    return { target: 'SHARED', participantId: null, quantityMilli: allowed }
  }
  if (!portion.participantId) return null
  return {
    target: 'PARTICIPANT',
    participantId: portion.participantId,
    quantityMilli: allowed,
  }
}

/** Applies `clampPortion` over a list, letting each consume the running budget. */
function clampPortions(
  portions: DraftPortion[],
  budget: number,
): DraftPortion[] {
  let remaining = toMilli(budget)
  const result: DraftPortion[] = []
  for (const portion of portions) {
    const clamped = clampPortion(portion, remaining)
    if (!clamped) continue
    remaining -= clamped.quantityMilli
    result.push(clamped)
  }
  return result
}

function findItem(draft: ReceiptDraft, itemId: string): DraftItem | undefined {
  return draft.items.find((item) => item.id === itemId)
}

function cloneItem(item: DraftItem): DraftItem {
  return { ...item, portions: item.portions.map((portion) => ({ ...portion })) }
}

/**
 * Returns a new draft with `itemId` replaced by `update(item)`. When the id is
 * unknown the draft is copied unchanged, so callers always get a fresh object.
 */
function mapItem(
  draft: ReceiptDraft,
  itemId: string,
  update: (item: DraftItem) => DraftItem,
): ReceiptDraft {
  let found = false
  const items = draft.items.map((item) => {
    if (item.id !== itemId) return item
    found = true
    return update(item)
  })
  if (!found) return { ...draft, items: [...draft.items] }
  return { ...draft, items }
}

/**
 * Deep-copies a persisted receipt into an editable draft, sorting items by
 * `position`. The input is never referenced by the result.
 */
export function draftFromReceipt(receipt: ReceiptInput): ReceiptDraft {
  return {
    printedTotal: receipt.total,
    optedOutParticipantIds: receipt.optOuts.map(
      (optOut) => optOut.participantId,
    ),
    items: receipt.items
      .map((item) => ({
        id: item.id,
        name: item.name,
        quantityMilli: item.quantityMilli,
        unitPrice: item.unitPrice,
        amount: item.amount,
        isShared: item.isShared,
        isAdjustment: item.isAdjustment,
        position: item.position,
        portions: item.portions.map((portion) => ({
          target: portion.target,
          participantId: portion.participantId,
          quantityMilli: portion.quantityMilli,
        })),
      }))
      .sort((a, b) => a.position - b.position),
  }
}

/** Recomputes the provisional split for a draft. */
export function computeDraftSplit(
  draft: ReceiptDraft,
  participantIds: string[],
): ReceiptSplitResult {
  return computeReceiptSplit({
    participantIds,
    optedOutParticipantIds: draft.optedOutParticipantIds,
    items: toReceiptSplitItems(draft.items),
  })
}

/**
 * Replaces an item's portions, clamping them in order so their quantities never
 * exceed the item's own quantity. SHARED portions lose their participant and
 * PARTICIPANT portions without one are dropped.
 */
export function setItemPortions(
  draft: ReceiptDraft,
  itemId: string,
  portions: DraftPortion[],
): ReceiptDraft {
  return mapItem(draft, itemId, (item) => ({
    ...item,
    portions: clampPortions(portions, item.quantityMilli),
  }))
}

/**
 * Divides the item's quantity equally among the participants (largest
 * remainder, so the portions sum to exactly the item quantity).
 */
export function splitItemEqually(
  draft: ReceiptDraft,
  itemId: string,
  participantIds: string[],
): ReceiptDraft {
  const item = findItem(draft, itemId)
  if (!item) return { ...draft, items: [...draft.items] }
  const quantities = distributeAmount(item.quantityMilli, participantIds.length)
  const portions: DraftPortion[] = []
  participantIds.forEach((participantId, index) => {
    const quantityMilli = quantities[index] ?? 0
    if (quantityMilli > 0) {
      portions.push({ target: 'PARTICIPANT', participantId, quantityMilli })
    }
  })
  return setItemPortions(draft, itemId, portions)
}

/**
 * Removes the portion at `index`; the freed quantity becomes part of the
 * derived unassigned remainder.
 */
export function removePortion(
  draft: ReceiptDraft,
  itemId: string,
  index: number,
): ReceiptDraft {
  return mapItem(draft, itemId, (item) => {
    if (index < 0 || index >= item.portions.length) return cloneItem(item)
    return {
      ...item,
      portions: item.portions.filter((_, i) => i !== index),
    }
  })
}

/** Adds or removes a participant from the opted-out set. */
export function setOptOut(
  draft: ReceiptDraft,
  participantId: string,
  optedOut: boolean,
): ReceiptDraft {
  const already = draft.optedOutParticipantIds.includes(participantId)
  if (optedOut === already) {
    return {
      ...draft,
      optedOutParticipantIds: [...draft.optedOutParticipantIds],
    }
  }
  return {
    ...draft,
    optedOutParticipantIds: optedOut
      ? [...draft.optedOutParticipantIds, participantId]
      : draft.optedOutParticipantIds.filter((id) => id !== participantId),
  }
}

/**
 * Updates an item's editable fields. Shrinking the quantity re-clamps the
 * portions so they never exceed it.
 */
export function updateItem(
  draft: ReceiptDraft,
  itemId: string,
  patch: Partial<
    Pick<
      DraftItem,
      'name' | 'quantityMilli' | 'amount' | 'isShared' | 'unitPrice'
    >
  >,
): ReceiptDraft {
  return mapItem(draft, itemId, (item) => {
    const next = { ...item, ...patch }
    if (patch.quantityMilli !== undefined) {
      next.portions = clampPortions(next.portions, next.quantityMilli)
    }
    return next
  })
}

/** Appends a new, unassigned item at the end of the list. */
export function addItem(
  draft: ReceiptDraft,
  item: {
    id: string
    name: string
    quantityMilli: number
    amount: number
    isShared: boolean
  },
): ReceiptDraft {
  const position =
    draft.items.reduce(
      (max, existing) => Math.max(max, existing.position),
      -1,
    ) + 1
  return {
    ...draft,
    items: [
      ...draft.items,
      {
        id: item.id,
        name: item.name,
        quantityMilli: item.quantityMilli,
        unitPrice: null,
        amount: item.amount,
        isShared: item.isShared,
        isAdjustment: false,
        position,
        portions: [],
      },
    ],
  }
}

/** Removes an item from the draft. */
export function deleteItem(draft: ReceiptDraft, itemId: string): ReceiptDraft {
  return { ...draft, items: draft.items.filter((item) => item.id !== itemId) }
}

/** The quantity of an item claimed by its portions, capped at the item quantity. */
export function itemAssignedQuantity(item: DraftItem): number {
  const assigned = item.portions.reduce(
    (sum, portion) => sum + toMilli(portion.quantityMilli),
    0,
  )
  return Math.min(assigned, toMilli(item.quantityMilli))
}

/** The derived unassigned remainder of an item. */
export function itemRemainingQuantity(item: DraftItem): number {
  return Math.max(toMilli(item.quantityMilli) - itemAssignedQuantity(item), 0)
}

export type SectionEntry = {
  item: DraftItem
  quantityMilli: number
}

export type ReceiptSections = {
  unassigned: SectionEntry[]
  shared: SectionEntry[]
  byParticipant: { participantId: string; entries: SectionEntry[] }[]
}

/**
 * Buckets each item's portions into the Unassigned, Shared and per-participant
 * sections. Consumption (clamping, the shared-item fallback and the derived
 * unassigned remainder) is delegated to the split module, so the sections and
 * the money split can never disagree. Every participant gets an entry, in the
 * given order.
 */
export function buildReceiptSections(
  draft: ReceiptDraft,
  participantIds: string[],
): ReceiptSections {
  const unassigned: SectionEntry[] = []
  const shared: SectionEntry[] = []
  const order = Array.from(new Set(participantIds))
  const knownParticipantIds = new Set(order)
  const entriesByParticipant = new Map<string, SectionEntry[]>(
    order.map((participantId) => [participantId, []]),
  )

  for (const item of draft.items) {
    const [splitItem] = toReceiptSplitItems([item])
    const { portions, unassigned: remainder } = consumeItemPortions(
      splitItem,
      knownParticipantIds,
    )

    for (const portion of portions) {
      if (portion.target === 'SHARED') {
        shared.push({ item, quantityMilli: portion.quantityMilli })
      } else {
        entriesByParticipant
          .get(portion.participantId)!
          .push({ item, quantityMilli: portion.quantityMilli })
      }
    }

    if (remainder > 0) {
      unassigned.push({ item, quantityMilli: remainder })
    }
  }

  return {
    unassigned,
    shared,
    byParticipant: order.map((participantId) => ({
      participantId,
      entries: entriesByParticipant.get(participantId) ?? [],
    })),
  }
}

/** Compares the sum of item amounts with the printed receipt total. */
export function reconcileDraft(draft: ReceiptDraft): {
  printedTotal: number | null
  itemsTotal: number
  delta: number
} {
  const itemsTotal = draft.items.reduce((sum, item) => sum + item.amount, 0)
  return {
    printedTotal: draft.printedTotal,
    itemsTotal,
    delta: draft.printedTotal === null ? 0 : draft.printedTotal - itemsTotal,
  }
}

/**
 * Why Apply is blocked, or `null` when it is allowed. Mirrors the server-side
 * guards in `applyReceiptToExpense` so the UI never enables a button the server
 * will reject:
 * - `EMPTY`: the receipt has no items to apply.
 * - `ALL_OPTED_OUT`: there is an unassigned pool but nobody shares it.
 * - `NEGATIVE_SHARE`: a negative total (e.g. an adjustment) pushes a
 *   participant below zero, which the `BY_AMOUNT` split cannot represent.
 */
export type ReceiptApplyBlocker = 'EMPTY' | 'ALL_OPTED_OUT' | 'NEGATIVE_SHARE'

export function receiptApplyBlocker(
  draft: ReceiptDraft,
  participantIds: string[],
): ReceiptApplyBlocker | null {
  const split = computeDraftSplit(draft, participantIds)
  if (split.itemsTotal === 0) return 'EMPTY'
  if (split.allOptedOut) return 'ALL_OPTED_OUT'
  if (split.participants.some((participant) => participant.total < 0)) {
    return 'NEGATIVE_SHARE'
  }
  return null
}
