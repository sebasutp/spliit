'use client'
import { Button } from '@/components/ui/button'
import { RuntimeFeatureFlags } from '@/lib/featureFlags'
import { trpc } from '@/trpc/client'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ExpenseForm } from './expense-form'

export function EditExpenseForm({
  groupId,
  expenseId,
  runtimeFeatureFlags,
}: {
  groupId: string
  expenseId: string
  runtimeFeatureFlags: RuntimeFeatureFlags
}) {
  const t = useTranslations('ExpenseForm')
  const { data: groupData } = trpc.groups.get.useQuery({ groupId })
  const group = groupData?.group

  const { data: categoriesData } = trpc.categories.list.useQuery()
  const categories = categoriesData?.categories

  const { data: expenseData } = trpc.groups.expenses.get.useQuery({
    groupId,
    expenseId,
  })
  const expense = expenseData?.expense

  const { mutateAsync: updateExpenseMutateAsync } =
    trpc.groups.expenses.update.useMutation()
  const { mutateAsync: deleteExpenseMutateAsync } =
    trpc.groups.expenses.delete.useMutation()

  const utils = trpc.useUtils()
  const router = useRouter()

  if (!group || !categories || !expense) return null

  return (
    <>
      {expense.receipt ? (
        <div className="mb-2 text-right">
          <Button
            asChild
            variant="link"
            size="sm"
            className="h-auto p-0 text-sm"
          >
            <Link href={`/groups/${groupId}/expenses/${expenseId}/items`}>
              {t('itemizeReceipt')}
            </Link>
          </Button>
        </div>
      ) : null}
      <ExpenseForm
        group={group}
        expense={expense}
        categories={categories}
        onSubmit={async (expenseFormValues, participantId) => {
          await updateExpenseMutateAsync({
            expenseId,
            groupId,
            expenseFormValues,
            participantId,
          })
          utils.groups.expenses.invalidate()
          router.push(`/groups/${group.id}`)
        }}
        onDelete={async (participantId) => {
          await deleteExpenseMutateAsync({
            expenseId,
            groupId,
            participantId,
          })
          utils.groups.expenses.invalidate()
          router.push(`/groups/${group.id}`)
        }}
        runtimeFeatureFlags={runtimeFeatureFlags}
      />
    </>
  )
}
