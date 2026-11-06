# Test script: Lightning resend (F7) and guest proposal sections (F8)

Run on https://withligament.com after this branch is deployed. No migration is needed.

- **Agency:** sign in as `gmarkant@gmail.com`.
- **Guest vendor:** a mailbox you can read that has **no** Ligament account, for example `gmarkant+lf1@gmail.com`
  (Gmail delivers plus addresses to the main inbox; Ligament matches the exact address, so it is a guest). For a second
  run use `+lf2`, `+lf3`: one address per run keeps every run a clean first send.
- Use one test project throughout. Call it the TEST PROJECT below.

Each step has a pass condition. A step that does not meet it is a fail; note what you saw.

## Part A. A Lightning invitation keeps its content after Resend (F7)

**A1. Send a Lightning RFP with content.**
Open https://withligament.com/agency/magic-rfp. Select the TEST PROJECT. Fill the brief (project name, client, scope
description, budget). Add:
- two evaluation criteria (for example "Creative quality" and "Price"),
- two budget categories (for example "Crew" and "Equipment"),
- one business requirement (any designation or insurance minimum),
- one reference material link (any URL, label "Moodboard").

Add the guest address as the only recipient and send.
**Pass:** the result step shows the recipient as sent, and the guest mailbox receives "invited you to bid" within a
few minutes.

**A2. Look at the guest page before the resend.**
Open the link in the email (it has the form `https://withligament.com/rfp/respond/<token>`). Keep the URL.
**Pass:** the page shows the scope item from A1, the reference material "Moodboard", the business requirement, and the
two budget categories (Crew, Equipment) in the budget section. Write down what you saw.

**A3. Resend.**
Open https://withligament.com/agency, select the TEST PROJECT, and go to the broadcast step of the wizard. Find the
card "Guest Invitation / Invite by email" and its "Pending Invitations" list. On the guest's row click **Resend**.
**Pass:** the button reads "Resending..." and then "Resend" again; the row's "Expires" time moves to about 72 hours
from now; the guest mailbox receives a second invitation email.

**A4. The guest page after the resend (the F7 check).**
Open the link from the **second** email.
**Pass, all of:**
- it is the same URL as A2 (a live link is reused);
- the scope item, the "Moodboard" material, the business requirement and the Crew and Equipment budget categories are
  all still shown, exactly as in A2;
- if the RFP showed the client name in A2, it still does; if it did not, it still does not.

**Fail:** any of those is missing or blank. (Before the fix, all of them disappeared.)

**A5. The agency rubric after the resend.**
From the guest page in A4, submit a bid (any proposal text, a budget, a timeline). Then open
https://withligament.com/agency/bids and open the new bid.
**Pass:** the bid's scoring uses the two criteria from A1 ("Creative quality", "Price"), not the default rubric.

**A6. A first send is unchanged.**
On https://withligament.com/agency/magic-rfp send the same TEST PROJECT brief again to the same guest address, this time
with a third evaluation criterion added.
**Pass:** the send succeeds and the agency's bid view for this vendor now shows three criteria. (A first send still
writes what it carries.)

## Part B. A guest's proposal sections survive the first submit (F8)

**B1. Fresh guest invitation.**
On https://withligament.com/agency/magic-rfp send a Lightning RFP on the TEST PROJECT to a new guest address
(`gmarkant+lf2@gmail.com`).
**Pass:** the invitation email arrives.

**B2. Submit a bid with sections.**
Open the link from the email. Fill the proposal text, budget and timeline, and fill all four sections:
- Approach: `B2 approach text`
- Relevant experience: `B2 experience text`
- Team and capacity: `B2 team text`
- Assumptions and risks: `B2 assumptions text`

Submit.
**Pass:** the page shows the bid as submitted.

**B3. Guest sees them after reload.**
Reload the same link.
**Pass:** the submitted bid shows all four section texts exactly as typed. (Before the fix they were blank after the
first submit.)

**B4. The agency's bid view (the F8 check).**
Open https://withligament.com/agency/bids and open the bid from `gmarkant+lf2@gmail.com`.
**Pass:** the bid detail shows the headings Approach, Relevant experience, Team and capacity, Assumptions and risks,
each with its B2 text.

**B5. Edit keeps them.**
On the guest link choose to edit the bid, change Approach to `B5 approach text`, leave the rest, and resubmit. Reload
https://withligament.com/agency/bids and open the bid again.
**Pass:** Approach reads `B5 approach text`; the other three still read their B2 text.

**B6. A bid with no sections is unchanged.**
Send one more guest invitation (`gmarkant+lf3@gmail.com`) and submit a bid with proposal text, budget and timeline but
all four sections empty. Open it on https://withligament.com/agency/bids.
**Pass:** the bid saves, and the bid detail shows no section headings at all (no empty "Approach" heading).

## Record

| Step | Pass / fail | Notes |
|---|---|---|
| A1 | | |
| A2 | | |
| A3 | | |
| A4 | | |
| A5 | | |
| A6 | | |
| B1 | | |
| B2 | | |
| B3 | | |
| B4 | | |
| B5 | | |
| B6 | | |
