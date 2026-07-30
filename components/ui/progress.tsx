'use client'

import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'

import { cn } from '@/lib/utils'

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        // Neutral track, not a tint of the fill color - the indicator uses bg-primary at
        // full opacity, and primary is a bright green (#C8F53C), so a bg-primary/20 track
        // read as a pale-green "filled" bar even at 0%, indistinguishable from real
        // progress at a glance. A hue-neutral track keeps 0% unambiguously empty.
        'bg-white/10 relative h-2 w-full overflow-hidden rounded-full',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="bg-primary h-full w-full flex-1 transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
