# Test script: client visibility tag (CV1) and G4

Run after `feat/client-visibility-tag` is deployed. Every step has a pass condition; a step that does not
meet it is a fail. Report: `docs/client-visibility-tag-report.md`.

Accounts: agency **gmarkant@gmail.com**, vendor **gmarkant@icloud.com** (use a second browser or a
private window for the vendor so both stay signed in).

## A. Bid Management (agency gmarkant@gmail.com)

Open https://withligament.com/agency/bids

| # | Do | Pass when |
|---|---|---|
| A1 | Look at the header line of each brief that lists vendors. | No switch anywhere on the page. Each brief header shows a tag reading "CLIENT HIDDEN" (muted grey) or "CLIENT SHOWN" (highlighted). A group with no brief record shows no tag. |
| A2 | Hover the tag on "Q3 Flagship Product Launch". | A tooltip reads "Client: <client name>". |
| A3 | Click the tag on "Q3 Flagship Product Launch" (note what it reads first). | A small menu opens with one action ("Hide client from vendors" if the tag read Client shown, "Show client to vendors" if it read Client hidden), one line "N vendors on this brief will see the client name." or "... will no longer see the client name." with N matching the distinct vendors listed under that brief, and Cancel and Confirm buttons. |
| A4 | Click Cancel. Reload the page. | The menu closes, the tag reads what it read before, no "Saving..." appears, and after the reload it still reads the same. |
| A5 | Keyboard: Tab to the tag, press Enter; press Escape; press Space; press Escape. | Enter opens the menu, Escape closes it with focus back on the tag, Space opens it, Escape closes it. Nothing changes. |
| A6 | If the tag reads "CLIENT HIDDEN", open it and Confirm "Show client to vendors" first, so the next step starts from shown. Then open the tag and Confirm "Hide client from vendors". | While saving the tag shows "Saving..."; then it reads "CLIENT HIDDEN". No error line under the tag. |
| A7 | Reload the page. | "Q3 Flagship Product Launch" still reads "CLIENT HIDDEN". |
| A8 | Look beside the tag on "Q3 Flagship Product Launch". | "Brief text names the client" shows as a quiet amber tag (only while hidden), if the brief text names the client. If it does not show, note it: this brief's text may not name the client (not a fail of the tag). |
| A9 | Look beside the tag on "FY2026 Brand Momentum Initiative". | A quiet amber tag "Brief text shows figures" is shown. It is read-only: clicking it does nothing. |

## B. Vendor view (vendor gmarkant@icloud.com)

Keep the agency window from part A open.

| # | Do | Pass when |
|---|---|---|
| B1 | With "Q3 Flagship Product Launch" hidden (A7), open https://withligament.com/partner/rfps/26a383d8-f01c-4055-9c54-9159deec405e | No "Client: ..." label anywhere on the page. |
| B2 | In the agency window, open the tag on "Q3 Flagship Product Launch" and Confirm "Show client to vendors". Then reload the vendor page. | The vendor page shows "Client: <client name>". The agency tag reads "CLIENT SHOWN". |
| B3 | In the agency window, open the tag and Confirm "Hide client from vendors". Reload the vendor page. | The "Client: ..." label is gone. |

## C. Send steps (agency gmarkant@gmail.com). Do not send.

### C1. RFP Broadcast wizard

Open https://withligament.com/agency, select a project with a client, and go through to the send step.

| # | Do | Pass when |
|---|---|---|
| C1.1 | Look at the send step. | The "Show client name to vendors" switch is present and reads "CLIENT HIDDEN" (off) by default. |
| C1.2 | In the overview, type the project's client name and "$50,000". Wait about a second. | A "Vendors will read this text" warning appears above the send button listing Overview twice: "Names the client while the client is hidden" and "Shows a money figure or percentage". |
| C1.3 | Go back to Budget categories, add a category (or edit one) and put the client name and "$50,000" in its note. Return to the send step and wait about a second. | The warning also lists "<category name>: budget category note" for the client name and for "$50,000". |
| C1.4 | Click "Suggest vendor-safe rewrite". | For each flagged field a "Suggested: ..." block shows the change as plain text: removed words struck through in red, added words in green, no HTML markup visible. "Use this text" and "Keep mine" are offered. |
| C1.5 | Click "Keep mine" on each, then leave the page without sending (close the tab or navigate away). | Nothing was sent: no new brief appears on /agency/bids. |

### C2. Lightning

Open https://withligament.com/agency/magic-rfp, select a project with a client, fill the brief, and go to the send step.

| # | Do | Pass when |
|---|---|---|
| C2.1 | Look at the send step. | The "Show client name to vendors" switch is present and off ("CLIENT HIDDEN") by default. |
| C2.2 | In the scope description type the client name and "$50,000" (Release budget off). Wait about a second. | The warning lists the description for the client name and for "$50,000". |
| C2.3 | Open Budget categories on this page, put the client name and "$50,000" in a category note. Wait about a second. | The warning also lists "<category name>: budget category note" for both. |
| C2.4 | Click "Suggest vendor-safe rewrite". | A plain-text word diff is shown per flagged field, as in C1.4. |
| C2.5 | Click "Keep mine", then leave without sending. | Nothing was sent. |

## Afterwards

Put "Q3 Flagship Product Launch" back to the setting it had before A3 if it differed.
