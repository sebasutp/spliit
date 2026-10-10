'use client'

import { AssignItemDialog } from '@/app/groups/[groupId]/expenses/[expenseId]/items/assign-item-dialog'
import { ReceiptFooter } from '@/app/groups/[groupId]/expenses/[expenseId]/items/receipt-footer'
import {
  type ItemEditPatch,
  ReceiptItemRow,
  formatQuantityMilli,
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
import type { ReceiptPortionTarget } from '@/lib/enums'
import {
  type DraftItem,
  type DraftPortion,
  type ReceiptDraft,
  type SectionEntry,
  buildReceiptSections,
  canApplyDraft,
  computeDraftSplit,
  deleteItem as draftDeleteItem,
  draftFromReceipt,
  removePortion as draftRemovePortion,
  setItemPortions as draftSetItemPortions,
  setOptOut as draftSetOptOut,
  updateItem as draftUpdateItem,
  reconcileDraft,
} from '@/lib/receipt-draft'
import {
  amountAsMinorUnits,
  formatCurrency,
  getCurrencyFromGroup,
} from '@/lib/utils'
import { trpc } from '@/trpc/client'
import type { AppRouterOutput } from '@/trpc/routers/_app'
import { Plus } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
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
  const pendingUpdatesRef = useRef(
    new Map<
      string,
      { patch: ItemEditPatch; timer: ReturnType<typeof setTimeout> }
    >(),
  )

  // Seed the editable draft from the server exactly once, so a background
  // refetch can never clobber in-progress edits.
  useEffect(() => {
    if (!initialisedRef.current && receiptData) {
      initialisedRef.current = true
      setDraft(toDraft(receiptData.receipt))
    }
  }, [receiptData])

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
    setDraft(toDraft(data.receipt))
  }, [utils, groupId, expenseId])

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
      toast({
        title: t('applySuccess.title'),
        description: t('applySuccess.description'),
      })
      void utils.groups.receipts.get.invalidate()
      void utils.groups.expenses.get.invalidate()
      void utils.groups.expenses.list.invalidate()
      void utils.groups.get.invalidate()
      router.refresh()
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
  const canApply = useMemo(
    () => (draft ? canApplyDraft(draft, participantIds) : false),
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

  const applyReceipt = () => {
    applyMutation.mutate({ groupId, receiptId, expenseId })
  }

  // Applying is never automatic: a divergent expense needs an explicit confirm.
  const handleApply = () => {
    if (divergent) {
      setConfirmingApply(true)
      return
    }
    applyReceipt()
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

  const handleAssign = (itemId: string, portions: DraftPortion[]) => {
    setDraft((current) =>
      current ? draftSetItemPortions(current, itemId, portions) : current,
    )
    persistPortions(itemId, portions)
  }

  const handleRemovePortion = (itemId: string, index: number) => {
    const next = draftRemovePortion(draft, itemId, index)
    setDraft(next)
    const item = next.items.find((candidate) => candidate.id === itemId)
    if (item) persistPortions(itemId, item.portions)
  }

  const handleDeleteItem = (itemId: string) => {
    setDraft((current) =>
      current ? draftDeleteItem(current, itemId) : current,
    )
    deleteItemMutation.mutate({ groupId, receiptId, itemId })
  }

  const handleToggleOptOut = (participantId: string, optedOut: boolean) => {
    setDraft(draftSetOptOut(draft, participantId, optedOut))
    setOptOutMutation.mutate({ groupId, receiptId, participantId, optedOut })
  }

  const handleUpdateItem = (itemId: string, patch: ItemEditPatch) => {
    setDraft((current) =>
      current ? draftUpdateItem(current, itemId, patch) : current,
    )
    const pending = pendingUpdatesRef.current
    const existing = pending.get(itemId)
    if (existing) clearTimeout(existing.timer)
    const merged = { ...(existing?.patch ?? {}), ...patch }
    const timer = setTimeout(() => {
      pending.delete(itemId)
      if (Object.keys(merged).length === 0) return
      updateItemMutation.mutate({ groupId, receiptId, itemId, ...merged })
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

    await addItemMutation.mutateAsync({
      groupId,
      receiptId,
      name,
      quantityMilli,
      amount: Math.max(amountAsMinorUnits(parsedAmount, currency), 1),
      isShared: newShared,
    })

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
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-8">
      <header className="flex flex-col gap-2">
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
        canApply={canApply}
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
                  applyReceipt()
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
