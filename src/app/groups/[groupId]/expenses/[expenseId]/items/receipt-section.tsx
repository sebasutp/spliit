'use client'

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'
import { type ReactNode, useState } from 'react'

type Props = {
  title: string
  hint?: string
  /** A compact "count · quantity" summary shown next to the title. */
  summary: string
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * A collapsible bucket of receipt rows (Unassigned, Shared or one participant).
 * Purely presentational: the parent renders the rows as children.
 */
export function ReceiptSection({
  title,
  hint,
  summary,
  defaultOpen = true,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-lg border bg-card"
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-4 text-left">
        <div className="min-w-0">
          <div className="truncate font-medium">{title}</div>
          {hint ? (
            <div className="truncate text-xs text-muted-foreground">{hint}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <span>{summary}</span>
          <ChevronDown
            className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
          />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t p-2">
        <ul className="flex flex-col gap-1">{children}</ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
