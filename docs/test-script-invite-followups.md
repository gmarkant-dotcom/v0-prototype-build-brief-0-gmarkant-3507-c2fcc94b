# Test script: re-invites keep their content (G1, G2) and send results are shown (G3)

Run on https://withligament.com after `fix/invite-blanking-followups` is deployed. No migration is needed.

- **Agency:** sign in as `gmarkant@gmail.com`.
- **Guest vendor:** a mailbox you can read that has **no** Ligament account. Use `gmarkant+if1@gmail.com` for Part A and
  `gmarkant+if2@gmail.com` for Part B (Gmail delivers plus addresses to the main inbox; Ligament matches the exact
  address, so each is a guest). One address per part keeps each part's first send clean.
- Use one test project throughout. Call it the TEST PROJECT below.

Each step has a pass condition. A step that does not meet it is a fail; note what you saw.

The guest page does not show evaluation criteria (the rubric is agency-only). It shows the scope item, reference
materials, business requirements and budget categories. The rubric is checked on the agency side.

## Part A. The card form re-invites an existing address without blanking it (G1)

**A1. Send a Lightning RFP with content.**
Open https://withligament.com/agency/magic-rfp. Select the TEST PROJECT. Fill the brief (project name, scope
description, budget). Add two evaluation criteria ("Creative quality", "Price"), two budget categories ("Crew",
"Equipment"), one business requirement (any designation or insurance minimum) and one reference link labelled
"Moodboard". Add `gmarkant+if1@gmail.com` as the only recipient and send.
**Pass:** the result step shows the recipient as sent, and the mailbox receives "invited you to bid".

**A2. The guest page before the re-invite.**
Open the link in the email (`https://withligament.com/rfp/respond/<token>`). Keep the URL.
**Pass:** the page shows the scope item, "Moodboard", the business requirement, and Crew and Equipment. Write them down.

**A3. The card recognizes the address.**
Open https://withligament.com/agency, select the TEST PROJECT, and step through to the broadcast step (the last step,
"Broadcast RFPs"). In the card "Guest Invitation / Invite by email", type `gmarkant+if1@gmail.com` and wait a second.
**Pass, all of:**
- the hint under the field reads "An active invitation already exists. Resending delivers the same link with a
  refreshed expiry and keeps the RFP content it was sent with.";
- the button reads **Resend Invitation**;
- the "Require term disclosures with bids" checkbox is greyed out, with "A resend keeps the existing invitation's term
  disclosure setting." under it.

**A4. Re-invite from the card form.**
Click **Resend Invitation**.
**Pass:** "Invitation resent. The link expires in 72 hours." appears beside the button, the field clears, the guest's
row in "Pending Invitations" shows a new Expires time about 72 hours out, and a second invitation email arrives.

**A5. The guest page after the re-invite (the G1 check).**
Open the link from the second email.
**Pass, all of:** it is the same URL as A2; the scope item, "Moodboard", the business requirement, and Crew and
Equipment are all still shown, exactly as in A2.
**Fail:** any of them is missing or blank (before the fix all of them disappeared).

**A6. A first invite from the card is unchanged.**
In the same card type a never-used address, `gmarkant+if9@gmail.com`.
**Pass:** the hint reads "New vendor - will receive a guest invitation", the button reads **Send Invitation**, the
checkbox is enabled; clicking it shows "Invitation sent. The link expires in 72 hours." and the address appears in
"Pending Invitations".

## Part B. The wizard re-invites an existing address without blanking it (G2)

**B1. A guest invitation already exists.**
In the card on https://withligament.com/agency (TEST PROJECT, broadcast step), send a first invitation to
`gmarkant+if2@gmail.com`.
**Pass:** "Invitation sent. The link expires in 72 hours." and the email arrives. (This invitation has no content.)

**B2. Broadcast from the wizard to the same address.**
Click "Create another RFP" if a completion screen is showing, or start at https://withligament.com/agency with the
TEST PROJECT. Build the RFP through the wizard: on the master RFP step add two evaluation criteria ("Craft", "Value"),
two budget categories ("Talent", "Post"), one business requirement, and one reference material link labelled
"Treatment". Allocate one scope item to outsource. On the recipients step add `gmarkant+if2@gmail.com` as a new
recipient on that scope item and tick **Send as Magic Link**. On the broadcast step tick **Close bidding at deadline**
and set a deadline. Click **Broadcast RFPs**.
**Pass, all of:** the completion screen reads "RFPs Broadcasted Successfully!"; under "Guest invitations" a green line
shows `gmarkant+if2@gmail.com · <scope item>` and "Invitation sent. The link expires in 72 hours."; an email arrives.

**B3. The guest page shows the wizard's content (the G2 check).**
Open the link from the newest email.
**Pass, all of:** the page shows the scope item from B2, "Treatment", the business requirement from B2, Talent and Post
in the budget section, and the deadline from B2.
**Fail:** the business requirement or the budget categories are missing (before the fix the wizard sent them empty).

**B4. The rubric and the close flag (agency side).**
Submit a bid from the B3 page (any proposal text, a budget, a timeline). Open https://withligament.com/agency/bids and
open the bid.
**Pass:** scoring uses "Craft" and "Value", not the default rubric; the RFP shows bidding closes at the deadline.

## Part C. A failed resend shows a message (G3)

**C1. Signed-out resend (401).**
Open https://withligament.com/agency in two tabs, TEST PROJECT, broadcast step. In the second tab sign out. In the first
tab click **Resend** on any pending row in "Pending Invitations".
**Pass:** a red line under that row reads "Your session has expired. Sign in again, then retry." (Before the fix,
nothing happened.) Sign back in.

**C2. Offline resend (network).**
In Chrome open DevTools, Network tab, set throttling to **Offline**. Click **Resend** on a pending row.
**Pass:** a red line under the row reads "Network error. Check your connection and try again." Set throttling back to
"No throttling".

**C3. Offline send from the form.**
Still offline, type `gmarkant+if1@gmail.com` into the card form (the hint may not load) and click the button.
**Pass:** red text beside the button reads "Could not check for an existing invitation, so nothing was sent. Please
try again." Go back online; `gmarkant+if1@gmail.com`'s guest page from A5 still shows all its content.

**C4. A successful row resend.**
Back online, click **Resend** on the `gmarkant+if1@gmail.com` row.
**Pass:** a green line under the row reads "Invitation resent. The link expires in 72 hours." and an email arrives.

The 404 message ("There is no invitation to resend for this vendor. Send a new invitation instead.") needs a token
deleted underneath an open page, which is not possible from the UI; it is covered by `lib/agency-invite-request.test.ts`.

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
| C1 | | |
| C2 | | |
| C3 | | |
| C4 | | |
