import GroupExpensesPageClient from '@/app/groups/[groupId]/expenses/page.client'
import { env } from '@/lib/env'
import { getTranslations } from 'next-intl/server'

// Render at request time rather than caching for an hour, so the flag below
// reflects the environment the container was started with.
export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('Expenses')

  return {
    title: t('title'),
  }
}

export default async function GroupExpensesPage() {
  // The line-items calculator builds on receipt extraction, so enabling it also
  // enables (and must show the entry point for) the base extraction feature.
  const enableReceiptItems =
    env.ENABLE_RECEIPT_ITEMS || env.NEXT_PUBLIC_ENABLE_RECEIPT_ITEMS
  const enableReceiptExtract =
    env.ENABLE_RECEIPT_EXTRACT ||
    env.NEXT_PUBLIC_ENABLE_RECEIPT_EXTRACT ||
    enableReceiptItems

  return (
    <GroupExpensesPageClient
      enableReceiptExtract={enableReceiptExtract}
      enableReceiptItems={enableReceiptItems}
      s3PublicUrl={env.S3_PUBLIC_URL ?? null}
    />
  )
}
