"use client"
import { SWRConfig } from "swr"
import type { ReactNode } from "react"
import { fetcher } from "@/lib/fetcher"

export function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
        dedupingInterval: 30000,
        focusThrottleInterval: 60000,
        keepPreviousData: true,
        errorRetryCount: 2,
        // ONE FETCHER, NOT TWO. This was an inline copy that had drifted from
        // lib/fetcher.ts - the copy checked res.ok, the module did not, so an error body
        // reached components as data on exactly the hooks that used the module. The two
        // were diffed property by property before being collapsed; see lib/fetcher.ts.
        fetcher,
      }}
    >
      {children}
    </SWRConfig>
  )
}
