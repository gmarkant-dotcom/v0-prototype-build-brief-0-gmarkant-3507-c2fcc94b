# Budget UI: browser test script

**For:** branch `feat/budget-ui`. Run on a preview or local build of the branch.
**Accounts:** agency `gmarkant@gmail.com` (the paid m a r k a n t lead agency); vendor
`gmarkant@icloud.com` (April Partner Test Agency). Use two browsers or a private window for the vendor.
**Data:** generic examples only. Create a throwaway project named `Budget test - spring launch` (client
`Example Client`) for the run, so nothing real is touched.

Each step says what to do and what you must see. Record a step as failed if what you see differs.

---

## Part A. Before 103 is applied (spine not enabled)

1. Sign in as the agency. In the sidebar, **00 Budgeting** shows "Coming soon", is not a link and is
   not focusable with Tab.
2. Visit `/agency/budgeting` directly. The page loads with the title Budgeting and a card
   "Budgeting is not enabled yet". No error page, no spinner that never ends.
3. Visit `/agency/budgeting/templates`. Same "not enabled" card.
4. Open `/agency/budgeting/<the test project id>` (copy the id from the project URL in Delivery or
   Clients + Projects). The header shows the project name; every tab shows a "not enabled" card.
5. Sign in as the vendor. The top nav has **no** Budget Documents item. Visit
   `/partner/budget-documents` directly: "Budget documents are not available yet."

## Part B. After 103, before 104

6. Agency: reload any agency page. **00 Budgeting** is now a link. Click it: `/agency/budgeting`
   lists your projects. The test project shows "Example Client · No budget yet" and a **Start budget**
   button.
7. Open the test project's budget. Ledger tab: "The ledger is not enabled yet". Documents tab:
   "Budget documents are not enabled yet". Summary tab: estimates show; Actual reads "No ledger yet".
8. Vendor: still no Budget Documents nav item (it needs 104).

## Part C. After 103 and 104 (full run)

### Agency template and composition (U2)

9. Go to `/agency/budgeting` and click **Agency template**. If the template is empty you see
   "Your template is empty..." and the composer below.
10. In **Compose from starters**, click **Live-action video production** and **Photo shoot**. Both cards
    show a lime check. Click **Choose categories**.
11. The list shows each category once. "Locations and permits" (in both starters) appears once with
    "Live-action video production · Photo shoot" under it. Uncheck **Catering**. Change
    **Director** from Cost to Fee, then back to Cost.
12. Click **Preview**. The count and the fee/cost split match what is checked. Click **Add N to
    template**. The result reads "N added".
13. Click **Compose more**, pick **Photo shoot** again, **Choose categories**: every category already
    added is greyed out with "Already in your template" and cannot be checked; **Catering** is still
    checkable. Add it. Result: "1 added".
14. Template editor: rename **Shoot crew** to `Production crew` (click away to save): a green
    confirmation appears. Change **Insurance** to Fee and back to Cost. Archive **Studio and stage
    rental**: it disappears; turn on **Show archived**: it is listed, greyed, "Archived". Restore it.
15. Add a category `Test delete me` marked Cost, then delete it with the bin icon: the dialog says
    projects keep their own copy; confirm; it is gone.
16. Add a category named `production crew` (lower case): refused with "Production crew is already in
    the template."
17. The starter library holds eight starters: Live-action video production (21 categories), Experiential
    and live event (19), Digital and social campaign (12), Photo shoot (14), Animation and
    post-production (14), Agency retainer (6), Brand identity and design (9), Audio and podcast
    production (9).

### Start a project budget (U1, R6)

18. `/agency/budgeting` → **Start budget** on the test project. You land on its budget with "Budget
    started with N categories copied from your agency template." N equals the live template count.
19. Back on `/agency/budgeting`, the project shows "Chart, no lines" and **Open budget**.
20. On the template page, rename `Production crew` to `Crew`. Open the project budget: the project's
    category is still **Production crew** (copy, not pointer).

### Budget tab

21. Under **Director**, add a line `Director fee - 2 shoot days` with estimate `12,500`. It appears with
    `12500.00`; the category subtotal and the header Estimate update.
22. Add a line `Tech scout` with estimate `0` under **Pre-production**.
23. Click the line estimate of `Director fee - 2 shoot days`, type `abc`, press Enter: an error
    "... is not an amount" and the value reverts. Type `13000.5`, Enter: saved as `13000.50`.
24. Type `1.234` as an estimate: refused, "More than two decimal places".
25. **R1, refused delete:** bin icon on `Director fee - 2 shoot days`. Dialog title "... cannot be
    deleted", text "This line has an estimate, so it cannot be deleted. Archive it to hide it (it can be
    restored), or set its estimate to 0 first." The button reads **Archive instead**. Cancel.
26. **R1, allowed delete:** bin icon on `Tech scout` (estimate 0): "Delete Tech scout?" → **Delete**.
    It is gone.
27. Archive a line with the archive icon: it disappears. **Show archived**: it reappears greyed,
    "Archived"; restore it.
28. **Rename a category:** pencil on **Wardrobe, hair and makeup** → `Wardrobe and grooming` →
    **Rename**. Message mentions the merge history. Open **Rename and merge history (1)**: it lists the
    old name merged into the new one.
29. **Merge:** merge icon on **Catering and craft services** (add a line `Lunch, 30 crew` = `900`
    first) → merge into **Travel and per diem**. Message: "1 line ... moved". The line now sits under
    Travel and per diem; history shows 2 entries.
30. **Switch fee or cost:** the repeat icon on **Agency production fee** (already Fee) offers "Mark ...
    as cost". Cancel. On **Art department and props** (Cost) choose Switch: it now shows FEE; history
    gains an entry. Switch it back.
31. **Promote:** add a category `Drone operator` (Cost) to the project. Click its promote icon: "added
    to your agency template... this project is unchanged". Promote it again: "already in your agency
    template". Check the template page: `Drone operator` is there.
32. **Delete a category in use:** bin on **Director** (it has a line): dialog with "Delete"; confirm →
    the dialog changes to "This category still has lines, merge history or ledger entries, so it cannot
    be deleted..." and **Archive instead**. Cancel.
33. **Archive a category:** archive `Drone operator`: hidden; Show archived lists it greyed; restore it.

### Import (U3)

34. Save this as `budget-import-sample.csv` (generic data; row 6 is a formula-injection probe, row 7 a
    bad amount, row 8 a credit):

```csv
Description,Category,Amount,Type
Director prep and shoot,Director,"$14,000.00",cost
Gaffer and grip package,"Camera, lighting and grip","3,250",cost
Location fee - warehouse,Locations and permits,2800,cost
Agency creative development,Creative development,"6,000.00",fee
Color session,Color grading,1450.5,cost
"=HYPERLINK(""http://example.com"",""click"")",Editorial,100,cost
Mystery line,Editorial,ten dollars,cost
Rental return credit,Camera rental,(250.00),cost
Hard drive shuttle,Shipping and drives,85,
```

35. Budget tab → **Import budget**. Leave "The first row holds column names" checked; choose the file.
    The mapping step guesses Description, Category, Amount and Fee or cost (Type). The preview shows
    three rows. **Review rows**.
36. The review table: rows 1-6 show **Ready** (Director, Camera lighting and grip, Locations and
    permits, Creative development, Color grading and Editorial matched existing categories). Row 7 is
    unchecked with "Excluded: "ten dollars" is not an amount". Row 8 shows category "New: Camera rental"
    with Cost.
    Row 9 shows "New: Shipping and drives" with fee or cost "Choose..." and "Mark the new category fee
    or cost"; **Import** is disabled with "1 included row needs attention".
37. Set row 9 to Cost. Row 6's description renders as plain text `=HYPERLINK(...)`, never a link.
38. **Suggest categories** (optional): click it. Either suggestions fill rows with a "Suggested" tag and a
    note to review them, or, if AI is not available for the account, "AI suggestions are not available.
    Choose categories by hand; the import works the same." The button then disappears. Nothing is
    imported by this step.
39. **Import 8 lines.** A progress line counts up. Result: "8 of 8 lines imported" and "Every included
    row was imported." New categories **Camera rental** and **Shipping and drives** exist; the credit
    line shows `-250.00`.
40. Re-open import with a file larger than 5 MB (any large file renamed `.csv`): refused with "This file
    is X MB. The limit is 5 MB". With a CSV of 2,001 data rows: refused with "This file has 2,001 rows.
    The limit is 2,000".

### Ledger (R2)

41. Ledger tab. Add an entry: date today, payee `Example Rentals Co`, amount `3250`, category **Camera,
    lighting and grip**, line **Gaffer and grip package**, document **Manual entry (no file)**. Message
    "Entry added: 3,250.00". The row shows "Counts toward Actual", Document "Manual entry".
42. Add the same entry again (a duplicate).
43. Add a credit: payee `Example Rentals Co`, amount `-150`, same category, no line, manual entry.
44. Header reads 3 entries · 0 voided · Actual 6,350.00.
45. **Void as duplicate:** **Void** on the second 3,250 entry. Pick the first entry as "Duplicate of",
    leave reason empty: **Void entry** stays disabled. Type `Entered twice`. Confirm. The row is struck
    through, VOIDED, "Entered twice", "Duplicate of <date> · Example Rentals Co · 3,250.00". It has no
    Void button. There is no delete control anywhere. Header: 2 entries · 1 voided · Actual 3,100.00.

### Summary

46. Summary tab. Metrics: Estimate (sum of all live lines), Actual 3,100.00, Margin (estimate) with "x%
    of fee plus cost", Margin (actual). Totals table: Fee total, Cost total, Project total. Check by hand:
    margin amount = Fee total; percent = fee / (fee + cost).
47. By category: **Camera, lighting and grip** shows the Gaffer line Actual 3,250.00 and "Not on a line (1
    entry)" -150.00; the category Actual is 3,100.00. The voided entry is not counted anywhere.

### Documents (R3, R4)

48. Documents tab: three "Manual entry: Example Rentals Co ..." rows (each manual ledger entry records
    its own reference), "Manual entry, no file", Source Agency, Vendor "Not shared", toggle off.
49. Turn the first one's toggle on: dialog "Share with a vendor" lists vendors with an active or
    suspended relationship. Choose **April Partner Test Agency** → **Share**. Message "... is visible to
    April Partner Test Agency." Vendor column shows the name.
50. **Archive all**: the dialog says files are kept and access is unchanged. Confirm: "3 documents
    archived". The list is empty with "Every document is archived".
    **Show archived** lists all three, greyed. **Unarchive all**: "3 documents restored".

### Export and formula-injection check

51. Header **Budget CSV**: a file `budget-test-spring-launch-budget.csv` downloads; message "Budget
    exported: N lines". Open it in a text editor (not a spreadsheet first):
    - every field is wrapped in double quotes;
    - columns are Category, Line, Fee or cost, Estimate, Actual;
    - the imported row 6 appears as `"Editorial","'=HYPERLINK(""http://example.com"",""click"")","cost","100.00",...`
      (a leading single quote, quotes doubled);
    - the credit line's estimate is `"'-250.00"` (every cell starting with `-` is prefixed, including
      numbers);
    - the last rows are Fee total, Cost total, Project total, Margin (fee total) and Margin percent.
52. Open the same file in Excel or Google Sheets: row 6 shows the text `=HYPERLINK(...)`, **not** a
    clickable link, and no formula runs.
53. **Ledger CSV**: `budget-test-spring-launch-ledger.csv` downloads, "Ledger exported: 3 entries,
    voided included". The voided entry has Status `voided`, its reason, and the kept entry's ID in
    "Duplicate of (entry ID)". Original category is filled for every row.

### Vendor view (U5)

54. Sign in as the vendor `gmarkant@icloud.com`. The top nav now shows **Budget Documents** (Resources,
    unnumbered). Open it.
55. Under the test project (or "Project" if the vendor cannot read the project row) and the agency name:
    exactly **one** document, the one shared in step 49, type "Manual entry", Source "Lead agency", and
    its date. The unshared one is **not** listed. No amounts, no budget, no ledger, no download.
56. Agency: turn that document's toggle off. Vendor: reload: "No documents have been shared with you
    yet."
57. Agency: archive all documents with the toggle back on. Vendor: the document is still listed (archive
    changes no one's access), marked Archived. Agency: unarchive all.
58. (Optional, needs a partnership status change) Set the vendor relationship to suspended: the document
    is still listed. Set it to terminated or removed: it disappears. Restore the relationship.
59. As the vendor, visit `/agency/budgeting`: the middleware sends a vendor away from agency routes; and
    any `/api/agency/budget/...` URL answers 402 `agency_entitlement_required` (or 403/404), never data.

### Upgrade (402) state

60. With an agency account whose organization is not paid (or not a lead agency), call
    `/api/agency/budget/projects` in the browser: 402 with code `agency_entitlement_required`. The pages
    themselves are normally unreachable for that account (the middleware redirects `/agency` to the access
    page); if reached, they show "Budgeting is part of the lead agency plan" with a link to the plan page.

## Cleanup

61. Archive the test project's lines and categories, or leave the test project in place; ledger entries
    cannot be deleted by design (R2), only voided.
