'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { Currency } from '@/lib/currency'
import type { ReceiptApplyBlocker } from '@/lib/receipt-draft'
import type { ReceiptSplitResult } from '@/lib/receipt-split'
import { formatCurrency } from '@/lib/utils'
import { useLocale, useTranslations } from 'next-intl'

export type ReceiptFooterParticipant = { id: string; name: string }

export type ReceiptFooterReconciliation = {
  printedTotal: number | null
  itemsTotal: number
  delta: number
}

type Props = {
  split: ReceiptSplitResult
  participants: ReceiptFooterParticipant[]
  currency: Currency
  reconciliation: ReceiptFooterReconciliation
  /** Why Apply is blocked, or null when it is allowed. `'EMPTY'` is shown as the empty hint. */
  applyBlocker: ReceiptApplyBlocker | null
  /** When true, the linked expense no longer matches the items total. */
  divergent?: boolean
  optedOutParticipantIds: string[]
  onApply: () => void
  onOptOutChange: (participantId: string, optedOut: boolean) => void
  applying?: boolean
}

/**
 * Sticky provisional-totals footer. Shows each participant's total with an
 * Own / Shared / Unassigned breakdown, an opt-out toggle, a reconciliation
 * badge against the printed total, and the (out-of-scope) Apply button.
 */
export function ReceiptFooter({
  split,
  participants,
  currency,
  reconciliation,
  applyBlocker,
  divergent = false,
  optedOutParticipantIds,
  onApply,
  onOptOutChange,
  applying = false,
}: Props) {
  const t = useTranslations('ReceiptItems')
  const locale = useLocale()

  const shareByParticipant = new Map(
    split.participants.map((share) => [share.participantId, share]),
  )
  const { printedTotal, itemsTotal, delta } = reconciliation
  const hasPrintedTotal = printedTotal !== null
  const reconciles = hasPrintedTotal && delta === 0
  const empty = applyBlocker === 'EMPTY'

  return (
    <div className="sticky bottom-0 z-10 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
        <ul className="flex flex-col gap-3">
          {participants.map((participant) => {
            const share = shareByParticipant.get(participant.id)
            const optedOut = optedOutParticipantIds.includes(participant.id)
            return (
              <li key={participant.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{participant.name}</span>
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(currency, share?.total ?? 0, locale)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span>{t('footer.own')}</span>
                    <span className="tabular-nums">
                      {formatCurrency(currency, share?.direct ?? 0, locale)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span>{t('footer.shared')}</span>
                    <span className="tabular-nums">
                      {formatCurrency(currency, share?.shared ?? 0, locale)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span>{t('footer.unassigned')}</span>
                    <span className="tabular-nums">
                      {formatCurrency(currency, share?.unassigned ?? 0, locale)}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`receipt-opt-out-${participant.id}`}
                    checked={!optedOut}
                    onCheckedChange={(checked) =>
                      onOptOutChange(participant.id, checked !== true)
                    }
                  />
                  <Label
                    htmlFor={`receipt-opt-out-${participant.id}`}
                    className="text-xs font-normal text-muted-foreground"
                  >
                    {t('footer.optOut')}
                  </Label>
                </div>
              </li>
            )
          })}
        </ul>

        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-col items-start gap-1">
            <Badge
              data-testid="reconciliation-badge"
              variant={reconciles ? 'secondary' : 'destructive'}
              className={!hasPrintedTotal ? 'text-muted-foreground' : undefined}
            >
              {!hasPrintedTotal
                ? `${t('footer.itemsTotal')}: ${formatCurrency(
                    currency,
                    itemsTotal,
                    locale,
                  )}`
                : reconciles
                  ? t('footer.reconciles')
                  : t('footer.offBy', {
                      amount: formatCurrency(currency, Math.abs(delta), locale),
                    })}
            </Badge>
            {divergent ? (
              <p
                data-testid="divergent-note"
                className="text-xs text-muted-foreground"
              >
                {t('footer.divergent')}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col items-end gap-1">
            {empty ? (
              <p
                data-testid="empty-note"
                className="text-xs text-muted-foreground"
              >
                {t('empty')}
              </p>
            ) : (
              <>
                <Button
                  onClick={onApply}
                  disabled={applyBlocker !== null || applying}
                  data-testid="apply-button"
                >
                  {t('footer.apply')}
                </Button>
                {applyBlocker !== null ? (
                  <p
                    className="text-xs text-destructive"
                    data-testid="apply-blocker"
                  >
                    {applyBlocker === 'NEGATIVE_SHARE'
                      ? t('footer.negativeShare')
                      : t('footer.allOptedOut')}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
