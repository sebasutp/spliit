import { ReceiptFooter } from '@/app/groups/[groupId]/expenses/[expenseId]/items/receipt-footer'
import { getCurrency } from '@/lib/currency'
import type { ReceiptSplitResult } from '@/lib/receipt-split'
import { formatCurrency } from '@/lib/utils'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import messages from '../../../../../../../messages/en-US.json'

// next-intl is ESM-only, which Jest does not transform inside node_modules.
// Stand the hooks up with the real catalogue and a tiny ICU-free resolver,
// since the footer only uses simple `{placeholder}` interpolation.
jest.mock('next-intl', () => {
  const catalog = require('../../../../../../../messages/en-US.json')

  const resolve = (namespace: string, key: string): unknown => {
    let value: any = catalog
    for (const part of `${namespace}.${key}`.split('.')) {
      value = value?.[part]
      if (value === undefined) return undefined
    }
    return value
  }

  return {
    useTranslations:
      (namespace: string) =>
      (key: string, values?: Record<string, unknown>) => {
        const raw = resolve(namespace, key)
        if (typeof raw !== 'string') return key
        return raw.replace(/\{(\w+)\}/g, (_, name: string) =>
          values && name in values ? String(values[name]) : `{${name}}`,
        )
      },
    useLocale: () => 'en-US',
  }
})

const currency = getCurrency('USD')
const locale = 'en-US'

const participants = [
  { id: 'alice', name: 'Alice' },
  { id: 'bob', name: 'Bob' },
]

const split: ReceiptSplitResult = {
  participants: [
    {
      participantId: 'alice',
      direct: 300,
      shared: 100,
      unassigned: 150,
      total: 550,
    },
    {
      participantId: 'bob',
      direct: 300,
      shared: 100,
      unassigned: 150,
      total: 550,
    },
  ],
  itemsTotal: 1200,
  sharedPool: 300,
  unassignedPool: 300,
  allOptedOut: false,
}

function renderFooter(
  overrides: Partial<ComponentProps<typeof ReceiptFooter>> = {},
) {
  return render(
    <ReceiptFooter
      split={split}
      participants={participants}
      currency={currency}
      reconciliation={{ printedTotal: 1200, itemsTotal: 1200, delta: 0 }}
      canApply
      optedOutParticipantIds={[]}
      onApply={() => {}}
      onOptOutChange={() => {}}
      {...overrides}
    />,
  )
}

describe('ReceiptFooter', () => {
  it('shows each participant’s total and Own / Shared / Unassigned breakdown', () => {
    renderFooter()

    // Total, once per participant.
    expect(
      screen.getAllByText(formatCurrency(currency, 550, locale)),
    ).toHaveLength(2)
    // Own, Shared and Unassigned values, once per participant.
    expect(
      screen.getAllByText(formatCurrency(currency, 300, locale)),
    ).toHaveLength(2)
    expect(
      screen.getAllByText(formatCurrency(currency, 100, locale)),
    ).toHaveLength(2)
    expect(
      screen.getAllByText(formatCurrency(currency, 150, locale)),
    ).toHaveLength(2)

    expect(screen.getAllByText('Own')).toHaveLength(2)
    expect(screen.getAllByText('Shared')).toHaveLength(2)
    expect(screen.getAllByText('Unassigned')).toHaveLength(2)
  })

  it('shows a match badge when the printed total reconciles', () => {
    renderFooter({
      reconciliation: { printedTotal: 1200, itemsTotal: 1200, delta: 0 },
    })

    expect(
      screen.getByText(messages.ReceiptItems.footer.reconciles),
    ).toBeVisible()
  })

  it('shows the off-by amount when the totals differ', () => {
    renderFooter({
      reconciliation: { printedTotal: 1250, itemsTotal: 1200, delta: 50 },
    })

    expect(
      screen.getByText(
        messages.ReceiptItems.footer.offBy.replace(
          '{amount}',
          formatCurrency(currency, 50, locale),
        ),
      ),
    ).toBeVisible()
  })

  it('disables Apply when canApply is false and shows the explanation', () => {
    renderFooter({ canApply: false })

    const apply = screen.getByRole('button', { name: 'Apply to expense' })
    expect(apply).toBeDisabled()
    expect(
      screen.getByText(messages.ReceiptItems.footer.allOptedOut),
    ).toBeVisible()
  })

  it('enables Apply when canApply is true', () => {
    renderFooter({ canApply: true })

    expect(
      screen.getByRole('button', { name: 'Apply to expense' }),
    ).toBeEnabled()
  })
})
