import useSWR from "swr"
import { fetcher } from "@/lib/fetcher"

export function useFetch(url: string) {
  const { data, error, isLoading } = useSWR(url || null, fetcher)
  return { data, error, isLoading }
}
