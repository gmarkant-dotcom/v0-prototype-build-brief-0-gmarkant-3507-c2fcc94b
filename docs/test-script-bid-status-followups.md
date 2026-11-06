# Test script: bid status follow-ups (O1, O2)

Run after `fix/bid-status-followups` is deployed. Two browsers (or one normal and one private window):

- **Agency:** gmarkant@gmail.com
- **Vendor:** gmarkant@icloud.com

**Setup:** two bids from gmarkant@icloud.com to gmarkant@gmail.com, both in status Submitted and never
shortlisted: **Bid A** and **Bid B**. They can be on one RFP or two. If none exist, send an RFP from
https://withligament.com/agency/bids to gmarkant@icloud.com and submit a bid from the vendor side
at https://withligament.com/partner/rfps. Write down the time each step is done; steps 9-11 use it.

Reload the agency bids page before you start so it has the new code.

## Fix 1: Cancel Meeting Request

| # | Who | Where | Action | Pass when |
|---|-----|-------|--------|-----------|
| 1 | Agency | https://withligament.com/agency/bids | Open Bid A. Click **Request Meeting** | Badge shows Meeting Requested |
| 2 | Vendor | https://withligament.com/partner/rfps | Find Bid A's RFP | Status reads **Meeting Requested** |
| 3 | Agency | https://withligament.com/agency/bids | Bid A: hover **Meeting Requested** until it reads **Cancel Meeting Request**, click it | Badge shows **Submitted**, not Under Review |
| 4 | Vendor | https://withligament.com/partner/rfps | Reload | Bid A reads **Submitted**, not "Changes Requested" |
| 5 | Agency | https://withligament.com/agency/bids | Open Bid B. Click **Shortlist**, then **Request Meeting** | Badge shows Meeting Requested |
| 6 | Agency | https://withligament.com/agency/bids | Bid B: hover and click **Cancel Meeting Request** | Badge shows **Shortlisted** |
| 7 | Vendor | https://withligament.com/partner/rfps | Reload | Bid B reads **Shortlisted**, not "Changes Requested" |
| 8 | Agency | https://withligament.com/agency/bids | Bid A (Submitted): type feedback and send it with **Request changes** | Badge shows **Under Review**; vendor at https://withligament.com/partner/rfps sees **Changes Requested**. This path is meant to stay as it was |

## Fix 2: first stamp wins

Uses Bid B from step 6 (shortlisted, meeting requested once, then cancelled).

| # | Who | Where | Action | Pass when |
|---|-----|-------|--------|-----------|
| 9 | Vendor | https://withligament.com/partner | Note the **Recent activity** entries for Bid B | "Your bid for ... was shortlisted" shows the step 5 time; "A meeting was requested ..." shows the step 5 time |
| 10 | Agency | https://withligament.com/agency/bids | Wait at least two minutes. Bid B: **Remove from shortlist**, then **Shortlist** again, then **Request Meeting** again | Each click succeeds; final badge Meeting Requested |
| 11 | Vendor | https://withligament.com/partner | Reload | Both Bid B entries still show the **step 5** times, not the step 10 time |

## Not a failure

- After step 6 and step 10 the vendor activity feed may show a second "shortlisted" entry. That is the
  milestone feed recording each entry into shortlisted (finding 2 in
  `docs/bid-status-followups-report.md`), not the dashboard date moving.
- Any bid cancelled to Under Review before this deploy stays Under Review; it is not repaired.
