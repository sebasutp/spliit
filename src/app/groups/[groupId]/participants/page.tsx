'use client'

import { useCurrentGroup } from '@/app/groups/[groupId]/current-group-context'
import { Checkbox } from '@/components/ui/checkbox'
import { trpc } from '@/trpc/client'
import { useTranslations } from 'next-intl'

export default function ParticipantsPage() {
  const t = useTranslations('Participants')
  const { group, groupId } = useCurrentGroup()
  const utils = trpc.useUtils()
  const { mutate } = trpc.groups.updateParticipant.useMutation({
    onSuccess: () => {
      utils.groups.get.invalidate({ groupId })
    },
  })

  if (!group) return null

  return (
    <div>
      <h2 className="font-bold text-lg mb-2">{t('title')}</h2>
      <div className="flex flex-col gap-2">
        {group.participants.map((participant) => (
          <div key={participant.id} className="flex items-center gap-2">
            <Checkbox
              id={participant.id}
              checked={participant.allExpensesAdded}
              onCheckedChange={(checked) => {
                mutate({
                  groupId,
                  participantId: participant.id,
                  allExpensesAdded: !!checked,
                })
              }}
            />
            <label htmlFor={participant.id}>{participant.name}</label>
          </div>
        ))}
      </div>
    </div>
  )
}
