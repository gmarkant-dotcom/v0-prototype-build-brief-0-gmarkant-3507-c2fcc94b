import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"

export function useFetch<T = unknown>(url: string) {
  const { data, error, isLoading } = useSWR<T>(url || null, fetcher)
  return { data, error, isLoading }
}
