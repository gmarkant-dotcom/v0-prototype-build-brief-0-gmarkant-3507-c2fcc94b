/**
 * THE FETCHER BEHIND hooks/useFetch.ts.
 *
 * It used to be, in its entirety:
 *
 *   export const fetcher = (url: string) => fetch(url).then((res) => res.json())
 *
 * NO res.ok CHECK. A 401, a 403 and a 500 all have JSON bodies in this codebase -
 * `{ error: "Unauthorized" }`, `{ error: "Vendors only" }`, `{ error: "Failed to load
 * dashboard data" }` - so every one of them was parsed and handed to the component AS DATA.
 * SWR never threw, `error` stayed undefined, `isLoading` went false, and the component was
 * given a defined object that simply did not have the key it was about to read.
 *
 * THAT IS WHAT PRODUCED THE LIVE SENTRY TypeError ON /partner. `app/partner/page.tsx:387`
 * reads `dashboardData?.needsResponse.items`. The optional chain short-circuits the WHOLE
 * chain when `dashboardData` is undefined, which is the case it was written for. It does not
 * short-circuit when `dashboardData` is `{ error: "..." }` - an object, so `?.` proceeds -
 * and `.items` is then read off `undefined`. The route was never at fault: it returns
 * `needsResponse: { items: [], expiredCount: 0, onboardingPending: [] }` at zero rows and
 * has no sparse path at all.
 *
 * THE QUIETER HALF, WHICH IS WORSE THAN THE CRASH. Every other consumer reads its payload
 * key with a `?? []` fallback - `data?.rfps ?? []`, `data?.projects ?? []`,
 * `data?.responses ?? []`. Those did not crash. They rendered a confident EMPTY STATE for a
 * request that had failed. A vendor whose session had expired was told they had no RFPs.
 *
 * ---------------------------------------------------------------------------
 * WHAT A CONSUMER SEES NOW, ON AN ERROR BODY
 *
 *   data       undefined      (was: the error body, as though it were the payload)
 *   error      Error          (was: undefined)
 *   isLoading  false          (unchanged)
 *
 * So `data?.x ?? []` still yields `[]` and still renders - nothing regresses - but `error`
 * is finally populated, which is what the error branches that already exist in this codebase
 * were always gated on.
 *
 * >>> THREE SURFACES HAVE ERROR UI THAT COULD NEVER FIRE UNTIL THIS CHANGE:
 * >>> app/partner/projects/page.tsx:764 and components/partner-rfp-surface.tsx:659, 716 and
 * >>> 740. They are written, they are correct, and they were unreachable for HTTP failures
 * >>> because `error` was never set. This turns them on. That is the intended effect and it
 * >>> is the second reason for this change, not a side effect of it.
 *
 * NOTHING READS `data.error` OFF A useFetch RESULT. All eight consumers were enumerated
 * before this was changed, and every `data.error` read in the repository belongs to a raw
 * `fetch()` call with its own `res.ok` check - a different code path that this file does not
 * touch. See docs/dashboard-guard-and-panel-report.md for the list.
 *
 * ---------------------------------------------------------------------------
 * THIS IS NOW BYTE-EQUIVALENT TO THE OTHER FETCHER, AND THE TWO ARE STILL SEPARATE.
 *
 * components/swr-provider.tsx carries its own inline `fetcher` in SWRConfig, and it has
 * always had the res.ok check this file was missing. Two fetchers, two behaviours, one
 * codebase - which is why the same failure produced a crash on one screen and a false empty
 * state on another depending only on which hook the author happened to reach for.
 *
 * After this change they behave identically, which is the precondition for collapsing them
 * into one. THEY ARE DELIBERATELY NOT COLLAPSED HERE - that is a separate change touching
 * every SWR call site in the app, and it is reported rather than taken.
 *
 * RETRIES. Throwing puts these requests under SWRConfig's `errorRetryCount: 2`, so a failed
 * load is attempted three times in total before `error` settles. That was already true of
 * every consumer using the provider's fetcher; it is now also true here.
 */
export const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  })
