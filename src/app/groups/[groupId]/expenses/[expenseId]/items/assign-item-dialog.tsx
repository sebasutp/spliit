'use client'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  type DraftItem,
  type DraftPortion,
  type ReceiptDraft,
  splitItemEqually,
} from '@/lib/receipt-draft'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

type Participant = { id: string; name: string }

type Mode = 'whole' | 'even' | 'custom'

const SHARED = 'SHARED'

/** Parses a units string into a non-negative quantity in thousandths. */
function toMilli(value: string): number {
  const parsed = Number(value.replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.round(parsed * 1000)
}

type Props = {
  item: DraftItem
  participants: Participant[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (portions: DraftPortion[]) => void
}

/**
 * Assigns or splits a single item into portions. The result is handed back as
 * `DraftPortion[]`; the parent is responsible for storing it and persisting.
 */
export function AssignItemDialog({
  item,
  participants,
  open,
  onOpenChange,
  onConfirm,
}: Props) {
  const t = useTranslations('ReceiptItems')
  // The parent mounts this dialog only while it is open, so lazy initial state
  // is enough to give each opening fresh, item-aware defaults.
  const [mode, setMode] = useState<Mode>('whole')
  const [wholeTarget, setWholeTarget] = useState<string>(
    item.isShared ? SHARED : (participants[0]?.id ?? SHARED),
  )
  const [evenSelection, setEvenSelection] = useState<string[]>(
    participants.map((participant) => participant.id),
  )
  const [custom, setCustom] = useState<Record<string, string>>({})

  const evenPortions = useMemo(() => {
    const draft: ReceiptDraft = {
      items: [item],
      optedOutParticipantIds: [],
      printedTotal: null,
    }
    return (
      splitItemEqually(draft, item.id, evenSelection).items[0]?.portions ?? []
    )
  }, [item, evenSelection])

  const customPortions = useMemo(() => {
    const portions: DraftPortion[] = []
    for (const participant of participants) {
      const quantityMilli = toMilli(custom[participant.id] ?? '')
      if (quantityMilli > 0) {
        portions.push({
          target: 'PARTICIPANT',
          participantId: participant.id,
          quantityMilli,
        })
      }
    }
    const sharedQuantity = toMilli(custom[SHARED] ?? '')
    if (sharedQuantity > 0) {
      portions.push({
        target: 'SHARED',
        participantId: null,
        quantityMilli: sharedQuantity,
      })
    }
    return portions
  }, [custom, participants])

  const customTotal = customPortions.reduce(
    (total, portion) => total + portion.quantityMilli,
    0,
  )
  const customExceeds = customTotal > item.quantityMilli

  const invalid =
    (mode === 'whole' && !wholeTarget) ||
    (mode === 'even' && evenPortions.length === 0) ||
    (mode === 'custom' && (customPortions.length === 0 || customExceeds))

  const handleConfirm = () => {
    if (invalid) return
    if (mode === 'whole') {
      onConfirm([
        wholeTarget === SHARED
          ? {
              target: 'SHARED',
              participantId: null,
              quantityMilli: item.quantityMilli,
            }
          : {
              target: 'PARTICIPANT',
              participantId: wholeTarget,
              quantityMilli: item.quantityMilli,
            },
      ])
    } else if (mode === 'even') {
      onConfirm(evenPortions)
    } else {
      onConfirm(customPortions)
    }
    onOpenChange(false)
  }

  const toggleEven = (participantId: string, checked: boolean) => {
    setEvenSelection((selection) =>
      checked
        ? Array.from(new Set([...selection, participantId]))
        : selection.filter((id) => id !== participantId),
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('assign.title')}</DialogTitle>
          <DialogDescription>
            {t('assign.description', { name: item.name })}
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={mode}
          onValueChange={(value) => setMode(value as Mode)}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="whole" id="assign-whole" />
            <Label htmlFor="assign-whole">{t('assign.whole')}</Label>
          </div>

          {mode === 'whole' ? (
            <Select value={wholeTarget} onValueChange={setWholeTarget}>
              <SelectTrigger className="ml-6 w-[calc(100%-1.5rem)]">
                <SelectValue placeholder={t('assign.selectParticipant')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SHARED}>{t('assign.everyone')}</SelectItem>
                {participants.map((participant) => (
                  <SelectItem key={participant.id} value={participant.id}>
                    {participant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          <div className="flex items-center gap-2">
            <RadioGroupItem value="even" id="assign-even" />
            <Label htmlFor="assign-even">{t('assign.even')}</Label>
          </div>

          {mode === 'even' ? (
            <div className="ml-6 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                {t('assign.evenHint')}
              </p>
              {participants.map((participant) => (
                <div key={participant.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`assign-even-${participant.id}`}
                    checked={evenSelection.includes(participant.id)}
                    onCheckedChange={(checked) =>
                      toggleEven(participant.id, checked === true)
                    }
                  />
                  <Label
                    htmlFor={`assign-even-${participant.id}`}
                    className="font-normal"
                  >
                    {participant.name}
                  </Label>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <RadioGroupItem value="custom" id="assign-custom" />
            <Label htmlFor="assign-custom">{t('assign.custom')}</Label>
          </div>

          {mode === 'custom' ? (
            <div className="ml-6 flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                {t('assign.customHint')}
              </p>
              {participants.map((participant) => (
                <div
                  key={participant.id}
                  className="flex items-center justify-between gap-2"
                >
                  <Label
                    htmlFor={`assign-custom-${participant.id}`}
                    className="font-normal"
                  >
                    {participant.name}
                  </Label>
                  <Input
                    id={`assign-custom-${participant.id}`}
                    type="number"
                    min="0"
                    step="0.25"
                    className="w-24"
                    value={custom[participant.id] ?? ''}
                    onChange={(event) =>
                      setCustom((current) => ({
                        ...current,
                        [participant.id]: event.target.value,
                      }))
                    }
                  />
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="assign-custom-shared" className="font-normal">
                  {t('assign.shared')}
                </Label>
                <Input
                  id="assign-custom-shared"
                  type="number"
                  min="0"
                  step="0.25"
                  className="w-24"
                  value={custom[SHARED] ?? ''}
                  onChange={(event) =>
                    setCustom((current) => ({
                      ...current,
                      [SHARED]: event.target.value,
                    }))
                  }
                />
              </div>
              {customExceeds ? (
                <p className="text-xs text-destructive">
                  {t('assign.exceeds')}
                </p>
              ) : null}
            </div>
          ) : null}
        </RadioGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('assign.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={invalid}>
            {t('assign.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
