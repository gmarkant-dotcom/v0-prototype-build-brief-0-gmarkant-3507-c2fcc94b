# Test script: small fixes 2026-11-06

Run after `fix/small-fixes-2026-11-06` is deployed. Every step has a pass condition; a step that does not
meet it is a fail. Report: `docs/small-fixes-2026-11-06-report.md`.

Accounts: agency **gmarkant@gmail.com**, vendor **gmarkant@icloud.com** (use a second browser or a
private window for the vendor so both stay signed in).

Before part 1, the agency needs one bid from gmarkant@icloud.com that reads **Submitted**. If there is
none, sign in as the vendor, open https://withligament.com/partner/rfps, open an RFP and submit a bid.

## 1. Un-shortlist returns the bid to Submitted

### 1A. Bid detail sheet

| # | Do | Pass when |
|---|---|---|
| 1A1 | Agency: open https://withligament.com/agency/bids and open the gmarkant@icloud.com bid that reads Submitted. Click **Shortlist**. | The button turns blue and reads "Shortlisted"; the bid's status reads Shortlisted. |
| 1A2 | Vendor: open https://withligament.com/partner/rfps and open the same RFP. | The bid status reads "Shortlisted". |
| 1A3 | Agency: hover the Shortlisted button (it turns red and reads "Remove from shortlist") and click it. | The button returns to outline "Shortlist"; the bid's status badge reads **Submitted**, not "Changes Requested". |
| 1A4 | Vendor: reload the RFP page from 1A2. | The status reads **"Submitted"**. "Changes Requested" appears nowhere on the page. |
| 1A5 | Vendor: open https://withligament.com/partner and look at Recent activity. | The item "Your bid for <scope item> was shortlisted" is still there (the shortlist happened; it is not erased). |
| 1A6 | Vendor: on the RFP page, edit one field of the bid and resubmit. | The edit saves and the status reads "Submitted". No refusal message. |

### 1B. Compare view

| # | Do | Pass when |
|---|---|---|
| 1B1 | Agency: on https://withligament.com/agency/bids tick two bids, including the gmarkant@icloud.com bid, and click **Compare 2 Bids**. Click **Shortlist** on the gmarkant@icloud.com column. | That Shortlist button turns blue. |
| 1B2 | Click the same Shortlist button again. Go back to the bids list and reload. | The bid reads **Submitted**. |
| 1B3 | Vendor: reload the RFP page. | The status reads "Submitted", not "Changes Requested". |

### 1C. Request changes still requests changes (regression)

| # | Do | Pass when |
|---|---|---|
| 1C1 | Agency: open the gmarkant@icloud.com bid (reads Submitted), type a note in the feedback box and click **Save Feedback**. | "Feedback submitted" shows; the bid's status badge reads "Changes Requested". |
| 1C2 | Vendor: reload the RFP page. | The status reads **"Changes Requested"** and the agency's note is shown. |

## 2. Client tag stays on the header line

Open https://withligament.com/agency/bids and expand "FY2026 Brand Momentum Initiative" (it carries the
"Brief text shows figures" tag). If "Q3 Flagship Product Launch" reads CLIENT HIDDEN and also shows
"Brief text names the client", use that one too.

| # | Do | Pass when |
|---|---|---|
| 2.1 | Window at full desktop width (about 1280 px or wider). | The header line reads, left to right: source label, project name, "Sent <date>", the amber warning tag(s); the CLIENT HIDDEN / CLIENT SHOWN tag is on the **same line, at the right edge**. |
| 2.2 | Open DevTools, device toolbar, width **768 px**. | The client tag is still on the first header line at the right. If the warning tags no longer fit, they move to a second line **under the title, on the left**; the client tag does not move to a line of its own. |
| 2.3 | Width **375 px**. | Same as 2.2: the client tag stays at the right of the first line. The project name may shorten with "..."; the warning tags wrap beneath it; nothing overlaps the client tag and there is no sideways scroll caused by the header. |
| 2.4 | At 375 px click the client tag. | The confirm menu opens as before (one action, the vendor line, Cancel and Confirm). Click Cancel; nothing changes. |

## 3. Send-route warnings include budget categories and requirements

The send pages do not display the warnings the routes return, so this part reads the response in
DevTools. **This sends a real RFP.** Send to gmarkant@icloud.com only.

### 3A. RFP Broadcast wizard

| # | Do | Pass when |
|---|---|---|
| 3A1 | Agency: open https://withligament.com/agency, pick a project with a client, keep the client **hidden** at the send step. Give one budget category the note `Cap is $50,000.` and put `5% retainage` in the requirements notes. Add gmarkant@icloud.com as the only recipient. | The in-page warning list (the browser check, unchanged) lists the category note and the requirements notes. |
| 3A2 | Open DevTools, Network. Send. Click the `broadcast-rfp` request, Response tab. | The send succeeds (status 200, `ok: true`). `warnings` contains an entry with `field` starting `budget_categories.` and ending `.note`, `reason: "figure"`, `matched: "$50,000"`, and one with `field: "business_criteria_required.notes"`, `reason: "figure"`, `matched: "5%"`. |
| 3A3 | Vendor: open https://withligament.com/partner/rfps. | The new RFP is there. The warnings appear nowhere on the vendor's page. |

### 3B. Lightning RFP

| # | Do | Pass when |
|---|---|---|
| 3B1 | Agency: open https://withligament.com/agency/magic-rfp, client hidden. Give one budget category the note `Approx 1.2M total` and put the client's name in the requirements notes. Recipient gmarkant@icloud.com. | The in-page warning list shows both. |
| 3B2 | DevTools, Network. Send. Click the `magic-link` POST, Response tab. | The send succeeds (status 200, a `token`). `warnings` contains a `budget_categories.<key>.note` entry with `reason: "figure"`, `matched: "1.2M"`, and a `business_criteria_required.notes` entry with `reason: "client_name"`. |
| 3B3 | Open the guest link from the vendor's email. | The bid page opens; no warning text appears on it. |

## 4. Invite list carries no token

| # | Do | Pass when |
|---|---|---|
| 4.1 | Agency: open https://withligament.com/agency, select a project that has guest invitations, go to the send step so the "Guest Invitation" card shows. Open DevTools, Network, and reload. | The card's "Pending Invitations" list shows each invite with name or email, "Sent ... · Expires ...", and its Pending / Submitted / Expired pill, as before. |
| 4.2 | Click the `magic-link?project_id=...` GET, Response tab. | Each entry in `invites` has exactly `id`, `vendor_email`, `vendor_name`, `status`, `created_at`, `expires_at`, `is_existing_partner`. There is **no `token`** key and none of the other token columns (`budget_categories`, `business_criteria_required`, `reference_materials`, ...). |
| 4.3 | Click **Resend** on a Pending invite to gmarkant@icloud.com. | The row shows the resend outcome message; the vendor receives the email, and its link opens the same bid page as before. |
| 4.4 | Click **View Bid** on a Submitted invite, if one exists. | https://withligament.com/agency/bids opens. |
