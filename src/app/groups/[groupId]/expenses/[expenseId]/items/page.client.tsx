'use client'

import { AssignItemDialog } from '@/app/groups/[groupId]/expenses/[expenseId]/items/assign-item-dialog'
import { ReceiptFooter } from '@/app/groups/[groupId]/expenses/[expenseId]/items/receipt-footer'
import {
  type ItemEditPatch,
  ReceiptItemRow,
} from '@/app/groups/[groupId]/expenses/[expenseId]/items/receipt-item-row'
import { ReceiptSection } from '@/app/groups/[groupId]/expenses/[expenseId]/items/receipt-section'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/use-toast'
import { useAnalytics } from '@/lib/analytics/context'
import type { ReceiptPortionTarget } from '@/lib/enums'
import { useActiveUser } from '@/lib/hooks'
import {
  type DraftItem,
  type DraftPortion,
  type ReceiptDraft,
  type SectionEntry,
  buildReceiptSections,
  computeDraftSplit,
  deleteItem as draftDeleteItem,
  draftFromReceipt,
  removePortion as draftRemovePortion,
  setItemPortions as draftSetItemPortions,
  setOptOut as draftSetOptOut,
  updateItem as draftUpdateItem,
  receiptApplyBlocker,
  reconcileDraft,
} from '@/lib/receipt-draft'
import {
  amountAsMinorUnits,
  formatCurrency,
  formatQuantityMilli,
  getCurrencyFromGroup,
} from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@/trpc/routers/_app'
import { ArrowLeft, Plus } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const UPDATE_DEBOUNCE_MS = 500

type ReceiptData = NonNullable<
  AppRouterOutput['groups']['receipts']['get']
>['receipt']

/**
 * Maps the tRPC receipt payload onto the pure draft shape. The persisted
 * portion target comes back as a plain string through the transport, so it is
 * narrowed here rather than trusting the wire type.
 */
function toDraft(receipt: ReceiptData): ReceiptDraft {
  return draftFromReceipt({
    total: receipt.total,
    optOuts: receipt.optOuts.map((optOut) => ({
      participantId: optOut.participantId,
    })),
    items: receipt.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantityMilli: item.quantityMilli,
      unitPrice: item.unitPrice,
      amount: item.amount,
      isShared: item.isShared,
      isAdjustment: item.isAdjustment,
      position: item.position,
      portions: item.portions.map((portion) => ({
        target: portion.target as ReceiptPortionTarget,
        participantId: portion.participantId,
        quantityMilli: portion.quantityMilli,
      })),
    })),
  })
}

type Props = {
  groupId: string
  expenseId: string
}

export default function ReceiptItemsPageClient({ groupId, expenseId }: Props) {
  const t = useTranslations('ReceiptItems')
  const locale = useLocale()
  const { toast } = useToast()
  const utils = trpc.useUtils()
  const router = useRouter()
  const sendEvent = useAnalytics()
  const itemsPath = `/groups/${groupId}/expenses/${expenseId}/items`
  const activeUser = useActiveUser(groupId)
  // Preserve activity-log attribution the way the expense form does; 'None'
  // means the user explicitly picked "no one".
  const activeParticipantId =
    activeUser && activeUser !== 'None' ? activeUser : undefined

  const receiptQuery = trpc.groups.receipts.get.useQuery({ groupId, expenseId })
  const groupQuery = trpc.groups.get.useQuery({ groupId })
  const receiptData = receiptQuery.data
  const group = groupQuery.data?.group

  const [draft, setDraft] = useState<ReceiptDraft | null>(null)
  const [assigningItem, setAssigningItem] = useState<DraftItem | null>(null)
  const [addingItem, setAddingItem] = useState(false)
  const [confirmingApply, setConfirmingApply] = useState(false)
  const [newName, setNewName] = useState('')
  const [newQuantity, setNewQuantity] = useState('1')
  const [newAmount, setNewAmount] = useState('')
  const [newShared, setNewShared] = useState(false)

  const initialisedRef = useRef(false)
  const itemizeTrackedRef = useRef(false)
  // Mirror of the draft state for mutation handlers: reading it avoids stale
  // closures when two quick actions run before React re-renders.
  const draftRef = useRef<ReceiptDraft | null>(null)
  const pendingUpdatesRef = useRef(
    new Map<
      string,
      { patch: ItemEditPatch; timer: ReturnType<typeof setTimeout> }
    >(),
  )
  // Debounced saves already sent to the server, so Apply can wait for them
  // before the server recomputes the split.
  const inFlightUpdatesRef = useRef(new Set<Promise<unknown>>())

  // Keeps the ref and the state in lockstep; every draft write goes through it.
  const updateDraft = useCallback((next: ReceiptDraft | null) => {
    draftRef.current = next
    setDraft(next)
  }, [])

  // Seed the editable draft from the server exactly once, so a background
  // refetch can never clobber in-progress edits.
  useEffect(() => {
    if (!initialisedRef.current && receiptData) {
      initialisedRef.current = true
      updateDraft(toDraft(receiptData.receipt))
    }
  }, [receiptData, updateDraft])

  // Report that a loaded receipt was opened in the items screen, once per
  // mount. Guarded by a ref because a background refetch hands back a new
  // `receiptData` object and would otherwise fire the event again.
  useEffect(() => {
    if (itemizeTrackedRef.current || !receiptData) return
    itemizeTrackedRef.current = true
    sendEvent({ event: 'receipt: itemize', props: {} }, itemsPath)
  }, [receiptData, sendEvent, itemsPath])

  // Drop any pending debounced saves when the screen unmounts.
  useEffect(() => {
    const pending = pendingUpdatesRef.current
    return () => {
      pending.forEach((entry) => clearTimeout(entry.timer))
      pending.clear()
    }
  }, [])

  const resync = useCallback(async () => {
    const data = await utils.groups.receipts.get.fetch({ groupId, expenseId })
    initialisedRef.current = true
    updateDraft(toDraft(data.receipt))
  }, [utils, groupId, expenseId, updateDraft])

  const handleMutationSuccess = useCallback(() => {
    void utils.groups.receipts.get.invalidate()
  }, [utils])

  // On failure the local draft is thrown away and reloaded from the server, so
  // the UI never diverges from what was actually stored.
  const handleMutationError = useCallback(() => {
    toast({
      variant: 'destructive',
      title: t('saveError.title'),
      description: t('saveError.description'),
    })
    void resync()
  }, [toast, t, resync])

  const mutationOptions = {
    onSuccess: handleMutationSuccess,
    onError: handleMutationError,
  }

  const setPortionsMutation =
    trpc.groups.receipts.setItemPortions.useMutation(mutationOptions)
  const updateItemMutation =
    trpc.groups.receipts.updateItem.useMutation(mutationOptions)
  const addItemMutation =
    trpc.groups.receipts.addItem.useMutation(mutationOptions)
  const deleteItemMutation =
    trpc.groups.receipts.deleteItem.useMutation(mutationOptions)
  const setOptOutMutation =
    trpc.groups.receipts.setOptOut.useMutation(mutationOptions)

  const applyMutation = trpc.groups.receipts.applyToExpense.useMutation({
    onSuccess: () => {
      sendEvent({ event: 'receipt: apply', props: {} }, itemsPath)
      toast({
        title: t('applySuccess.title'),
        description: t('applySuccess.description'),
      })
      void utils.groups.receipts.get.invalidate()
      void utils.groups.expenses.get.invalidate()
      void utils.groups.expenses.list.invalidate()
      void utils.groups.get.invalidate()
      // Return the user to the expense they were itemizing, where the applied
      // split is now visible.
      router.push(`/groups/${groupId}/expenses/${expenseId}/edit`)
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: t('applyError.title'),
        description: error.message,
      })
    },
  })

  const participants = useMemo(
    () => receiptData?.participants ?? group?.participants ?? [],
    [receiptData, group],
  )
  const participantIds = useMemo(
    () => participants.map((participant) => participant.id),
    [participants],
  )

  const split = useMemo(
    () => (draft ? computeDraftSplit(draft, participantIds) : null),
    [draft, participantIds],
  )
  const sections = useMemo(
    () => (draft ? buildReceiptSections(draft, participantIds) : null),
    [draft, participantIds],
  )
  const reconciliation = useMemo(
    () => (draft ? reconcileDraft(draft) : null),
    [draft],
  )
  const applyBlocker = useMemo(
    () => (draft ? receiptApplyBlocker(draft, participantIds) : null),
    [draft, participantIds],
  )

  if (receiptQuery.isLoading || groupQuery.isLoading) {
    return <LoadingSkeleton />
  }

  if (receiptQuery.isError || !receiptData) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-center text-sm text-muted-foreground">
        {t('noReceipt')}
      </div>
    )
  }

  if (!draft || !split || !sections || !reconciliation || !group) {
    return <LoadingSkeleton />
  }

  const receipt = receiptData.receipt
  const receiptId = receipt.id
  const currency = getCurrencyFromGroup(group)
  const linkedExpense = receipt.expense
  // The receipt stays usable after a later manual edit; this only flags that the
  // expense no longer matches the items total.
  const divergent =
    linkedExpense !== null && linkedExpense.amount !== split.itemsTotal
  const footerParticipants = participants.map((participant) => ({
    id: participant.id,
    name: participant.name,
  }))

  const applyReceipt = async () => {
    try {
      await flushPendingUpdates()
    } catch {
      // A failed save already toasted and resynced the draft; applying now
      // would silently drop the user's latest edits.
      return
    }
    applyMutation.mutate({
      groupId,
      receiptId,
      expenseId,
      participantId: activeParticipantId,
    })
  }

  // Applying is never automatic: a divergent expense needs an explicit confirm.
  const handleApply = () => {
    if (divergent) {
      setConfirmingApply(true)
      return
    }
    void applyReceipt()
  }

  const summaryFor = (entries: SectionEntry[]) => {
    const totalQuantity = entries.reduce(
      (sum, entry) => sum + entry.quantityMilli,
      0,
    )
    return t('quantitySummary', {
      count: entries.length,
      quantity: formatQuantityMilli(totalQuantity, locale),
    })
  }

  const portionIndexFor = (item: DraftItem, participantId: string) =>
    item.portions.findIndex(
      (portion) =>
        portion.target === 'PARTICIPANT' &&
        portion.participantId === participantId,
    )

  const persistPortions = (itemId: string, portions: DraftPortion[]) => {
    setPortionsMutation.mutate({ groupId, receiptId, itemId, portions })
  }

  // Sends an item patch to the server immediately and tracks the promise so
  // Apply can await every queued write.
  const saveItemUpdate = (itemId: string, patch: ItemEditPatch) => {
    const promise = updateItemMutation.mutateAsync({
      groupId,
      receiptId,
      itemId,
      ...patch,
    })
    inFlightUpdatesRef.current.add(promise)
    // The rejection is surfaced by the mutation's onError; this copy only
    // exists to keep the tracked promise from rejecting unobserved.
    void promise
      .catch(() => undefined)
      .finally(() => inFlightUpdatesRef.current.delete(promise))
    return promise
  }

  // Clears every debounce timer synchronously, then awaits all queued and
  // in-flight saves so the split Apply recomputes server-side includes them.
  const flushPendingUpdates = async () => {
    const pending = pendingUpdatesRef.current
    const saves: Promise<unknown>[] = []
    pending.forEach((entry, itemId) => {
      clearTimeout(entry.timer)
      if (Object.keys(entry.patch).length > 0) {
        saves.push(saveItemUpdate(itemId, entry.patch))
      }
    })
    pending.clear()
    await Promise.all([...saves, ...inFlightUpdatesRef.current])
  }

  const handleAssign = (itemId: string, portions: DraftPortion[]) => {
    const current = draftRef.current
    if (!current) return
    updateDraft(draftSetItemPortions(current, itemId, portions))
    persistPortions(itemId, portions)
  }

  const handleRemovePortion = (itemId: string, index: number) => {
    const current = draftRef.current
    if (!current) return
    const next = draftRemovePortion(current, itemId, index)
    updateDraft(next)
    const item = next.items.find((candidate) => candidate.id === itemId)
    if (item) persistPortions(itemId, item.portions)
  }

  const handleDeleteItem = (itemId: string) => {
    const current = draftRef.current
    if (current) updateDraft(draftDeleteItem(current, itemId))
    deleteItemMutation.mutate({ groupId, receiptId, itemId })
  }

  const handleToggleOptOut = (participantId: string, optedOut: boolean) => {
    const current = draftRef.current
    if (!current) return
    updateDraft(draftSetOptOut(current, participantId, optedOut))
    setOptOutMutation.mutate({ groupId, receiptId, participantId, optedOut })
  }

  const handleUpdateItem = (itemId: string, patch: ItemEditPatch) => {
    const current = draftRef.current
    if (current) updateDraft(draftUpdateItem(current, itemId, patch))
    const pending = pendingUpdatesRef.current
    const existing = pending.get(itemId)
    if (existing) clearTimeout(existing.timer)
    const merged = { ...(existing?.patch ?? {}), ...patch }
    const timer = setTimeout(() => {
      pending.delete(itemId)
      if (Object.keys(merged).length === 0) return
      void saveItemUpdate(itemId, merged)
    }, UPDATE_DEBOUNCE_MS)
    pending.set(itemId, { patch: merged, timer })
  }

  const handleAddItem = async () => {
    const name = newName.trim()
    const parsedAmount = Number(newAmount)
    if (!name || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return
    const parsedQuantity = Number(newQuantity)
    const quantityMilli =
      Number.isFinite(parsedQuantity) && parsedQuantity > 0
        ? Math.round(parsedQuantity * 1000)
        : 1000

    try {
      await addItemMutation.mutateAsync({
        groupId,
        receiptId,
        name,
        quantityMilli,
        amount: Math.max(amountAsMinorUnits(parsedAmount, currency), 1),
        isShared: newShared,
      })
    } catch {
      // The mutation's onError already toasted and reloaded the draft; keep the
      // dialog open so the user can retry their input.
      return
    }

    setAddingItem(false)
    setNewName('')
    setNewQuantity('1')
    setNewAmount('')
    setNewShared(false)
    // The server generates the new item's id, so re-read it before editing.
    await resync()
  }

  const renderEntry = (entry: SectionEntry, participantId?: string) => {
    const portionIndex = participantId
      ? portionIndexFor(entry.item, participantId)
      : -1
    return (
      <ReceiptItemRow
        key={`${participantId ?? 'pool'}-${entry.item.id}-${portionIndex}`}
        item={entry.item}
        currency={currency}
        quantityMilli={entry.quantityMilli}
        onAssign={() => setAssigningItem(entry.item)}
        onEdit={(patch) => handleUpdateItem(entry.item.id, patch)}
        onDelete={() => handleDeleteItem(entry.item.id)}
        onRemovePortion={
          participantId && portionIndex >= 0
            ? () => handleRemovePortion(entry.item.id, portionIndex)
            : undefined
        }
      />
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-8 sm:px-4 sm:pt-4">
      <header className="flex flex-col gap-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 h-8 self-start text-muted-foreground"
        >
          <Link href={`/groups/${groupId}/expenses/${expenseId}/edit`}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            {t('backToExpense')}
          </Link>
        </Button>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">{t('title')}</h1>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setAddingItem(true)}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('addItem')}
          </Button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {receipt.merchant ? (
            <span>
              {t('merchant')}: {receipt.merchant}
            </span>
          ) : null}
          {receipt.total !== null ? (
            <span className="tabular-nums">
              {t('printedTotal')}:{' '}
              {formatCurrency(currency, receipt.total, locale)}
            </span>
          ) : null}
        </div>
      </header>

      <ReceiptSection
        title={t('sections.unassigned')}
        hint={t('sections.unassignedHint')}
        summary={summaryFor(sections.unassigned)}
      >
        {sections.unassigned.length > 0 ? (
          sections.unassigned.map((entry) => renderEntry(entry))
        ) : (
          <li className="p-2 text-sm text-muted-foreground">—</li>
        )}
      </ReceiptSection>

      <ReceiptSection
        title={t('sections.shared')}
        hint={t('sections.sharedHint')}
        summary={summaryFor(sections.shared)}
      >
        {sections.shared.length > 0 ? (
          sections.shared.map((entry) => renderEntry(entry))
        ) : (
          <li className="p-2 text-sm text-muted-foreground">—</li>
        )}
      </ReceiptSection>

      {sections.byParticipant.map(({ participantId, entries }) => {
        const participant = participants.find(
          (candidate) => candidate.id === participantId,
        )
        const name = participant?.name ?? ''
        return (
          <ReceiptSection
            key={participantId}
            title={name}
            hint={t('sections.participantHint', { name })}
            summary={summaryFor(entries)}
          >
            {entries.length > 0 ? (
              entries.map((entry) => renderEntry(entry, participantId))
            ) : (
              <li className="p-2 text-sm text-muted-foreground">—</li>
            )}
          </ReceiptSection>
        )
      })}

      <ReceiptFooter
        split={split}
        participants={footerParticipants}
        currency={currency}
        reconciliation={reconciliation}
        applyBlocker={applyBlocker}
        divergent={divergent}
        optedOutParticipantIds={draft.optedOutParticipantIds}
        onOptOutChange={handleToggleOptOut}
        onApply={handleApply}
        applying={applyMutation.isPending}
      />

      {divergent && linkedExpense ? (
        <Dialog open={confirmingApply} onOpenChange={setConfirmingApply}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('applyConfirm.title')}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t('applyConfirm.description')}
            </p>
            <p className="text-base font-semibold tabular-nums">
              {t('applyConfirm.total', {
                current: formatCurrency(currency, linkedExpense.amount, locale),
                new: formatCurrency(currency, split.itemsTotal, locale),
              })}
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmingApply(false)}
              >
                {t('applyConfirm.cancel')}
              </Button>
              <Button
                onClick={() => {
                  setConfirmingApply(false)
                  void applyReceipt()
                }}
              >
                {t('applyConfirm.confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {assigningItem ? (
        <AssignItemDialog
          item={assigningItem}
          participants={footerParticipants}
          open
          onOpenChange={(open) => {
            if (!open) setAssigningItem(null)
          }}
          onConfirm={(portions) => handleAssign(assigningItem.id, portions)}
        />
      ) : null}

      <Dialog open={addingItem} onOpenChange={setAddingItem}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('AddItemDialog.title')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-item-name">
                {t('AddItemDialog.nameLabel')}
              </Label>
              <Input
                id="new-item-name"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-item-quantity">
                {t('AddItemDialog.quantityLabel')}
              </Label>
              <Input
                id="new-item-quantity"
                type="number"
                min="0"
                step="0.001"
                value={newQuantity}
                onChange={(event) => setNewQuantity(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-item-amount">
                {t('AddItemDialog.amountLabel')}
              </Label>
              <Input
                id="new-item-amount"
                type="number"
                min="0"
                step="0.01"
                value={newAmount}
                onChange={(event) => setNewAmount(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="new-item-shared"
                type="checkbox"
                checked={newShared}
                onChange={(event) => setNewShared(event.target.checked)}
              />
              <Label htmlFor="new-item-shared" className="font-normal">
                {t('AddItemDialog.sharedLabel')}
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddingItem(false)}>
              {t('AddItemDialog.cancel')}
            </Button>
            <Button onClick={handleAddItem}>{t('AddItemDialog.add')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function LoadingSkeleton() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}
