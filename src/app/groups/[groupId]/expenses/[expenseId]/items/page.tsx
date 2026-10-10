import ReceiptItemsPageClient from '@/app/groups/[groupId]/expenses/[expenseId]/items/page.client'
import { env } from '@/lib/env'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'

// The feature flag is read from the environment at request time, so this page
// must not be statically cached.
export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('ReceiptItems')

  return {
    title: t('title'),
  }
}

export default async function ReceiptItemsPage({
  params,
}: {
  params: Promise<{ groupId: string; expenseId: string }>
}) {
  if (!(env.ENABLE_RECEIPT_ITEMS || env.NEXT_PUBLIC_ENABLE_RECEIPT_ITEMS)) {
    notFound()
  }

  const { groupId, expenseId } = await params

  return <ReceiptItemsPageClient groupId={groupId} expenseId={expenseId} />
}
