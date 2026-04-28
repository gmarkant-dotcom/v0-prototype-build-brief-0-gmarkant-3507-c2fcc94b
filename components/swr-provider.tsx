"use client"
import { SWRConfig } from "swr"
import type { ReactNode } from "react"

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
        fetcher: (url: string) =>
          fetch(url).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            return res.json()
          }),
      }}
    >
      {children}
    </SWRConfig>
  )
}
