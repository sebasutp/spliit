'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Currency } from '@/lib/currency'
import {
  type DraftItem,
  itemAssignedQuantity,
  itemRemainingQuantity,
} from '@/lib/receipt-draft'
import {
  amountAsMinorUnits,
  formatAmountAsDecimal,
  formatCurrency,
  formatQuantityMilli,
} from '@/lib/utils'
import { Pencil, Trash2, UserPlus, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

export type ItemEditPatch = {
  name?: string
  quantityMilli?: number
  amount?: number
}

type Props = {
  item: DraftItem
  currency: Currency
  /** The quantity of this item that belongs to the current section. */
  quantityMilli: number
  onAssign: () => void
  onEdit: (patch: ItemEditPatch) => void
  onDelete: () => void
  /** Present on participant-section rows; removes this portion. */
  onRemovePortion?: () => void
}

export function ReceiptItemRow({
  item,
  currency,
  quantityMilli,
  onAssign,
  onEdit,
  onDelete,
  onRemovePortion,
}: Props) {
  const t = useTranslations('ReceiptItems')
  const locale = useLocale()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const [name, setName] = useState(item.name)
  const [quantity, setQuantity] = useState(
    formatQuantityMilli(item.quantityMilli, locale),
  )
  const [amount, setAmount] = useState(
    formatAmountAsDecimal(item.amount, currency),
  )

  const assigned = itemAssignedQuantity(item)
  const remaining = itemRemainingQuantity(item)

  const openEdit = () => {
    setName(item.name)
    setQuantity(formatQuantityMilli(item.quantityMilli, locale))
    setAmount(formatAmountAsDecimal(item.amount, currency))
    setEditing(true)
  }

  const saveEdit = () => {
    const parsedQuantity = Number(quantity)
    const parsedAmount = Number(amount)
    const patch: ItemEditPatch = {}
    const trimmed = name.trim()
    if (trimmed && trimmed !== item.name) patch.name = trimmed
    if (Number.isFinite(parsedQuantity) && parsedQuantity > 0) {
      patch.quantityMilli = Math.max(Math.round(parsedQuantity * 1000), 1)
    }
    if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
      patch.amount = Math.max(amountAsMinorUnits(parsedAmount, currency), 1)
    }
    onEdit(patch)
    setEditing(false)
  }

  return (
    <li className="flex flex-col gap-2 rounded-md p-2 hover:bg-accent/50 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
      <div className="min-w-0 sm:flex-1">
        <div className="truncate font-medium">{item.name}</div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {t('item.quantity', {
              assigned: formatQuantityMilli(assigned, locale),
              total: formatQuantityMilli(item.quantityMilli, locale),
            })}
          </span>
          <span className="tabular-nums">
            {formatQuantityMilli(quantityMilli, locale)} ×
          </span>
          {remaining > 0 ? (
            <Badge variant="secondary" className="font-normal">
              {t('item.remaining', {
                quantity: formatQuantityMilli(remaining, locale),
              })}
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-1 sm:justify-end">
        <span className="mr-1 tabular-nums text-sm font-semibold">
          {formatCurrency(currency, item.amount, locale)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={t('item.assign')}
            aria-label={t('item.assign')}
            onClick={onAssign}
          >
            <UserPlus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={t('item.edit')}
            aria-label={t('item.edit')}
            onClick={openEdit}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={t('item.delete')}
            aria-label={t('item.delete')}
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          {onRemovePortion ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              title={t('item.removePortion')}
              aria-label={t('item.removePortion')}
              onClick={onRemovePortion}
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('item.editTitle')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`item-name-${item.id}`}>
                {t('item.nameLabel')}
              </Label>
              <Input
                id={`item-name-${item.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`item-quantity-${item.id}`}>
                {t('item.quantityLabel')}
              </Label>
              <Input
                id={`item-quantity-${item.id}`}
                type="number"
                min="0"
                step="0.001"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`item-amount-${item.id}`}>
                {t('item.amountLabel')}
              </Label>
              <Input
                id={`item-amount-${item.id}`}
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(false)}>
              {t('item.cancel')}
            </Button>
            <Button onClick={saveEdit}>{t('item.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('item.deleteConfirm')}</DialogTitle>
            <DialogDescription>{t('item.deleteDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmingDelete(false)}
            >
              {t('item.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmingDelete(false)
                onDelete()
              }}
            >
              {t('item.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  )
}
