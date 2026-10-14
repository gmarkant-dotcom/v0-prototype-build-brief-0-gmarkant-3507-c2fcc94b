# Budget UI: browser test script

**For:** branch `feat/budget-ui`. Run on a preview or local build of the branch. Part D is
`feat/budget-line-math` (116, applied 2026-10-14); Part E is `feat/budget-line-kind` (117).
**Accounts:** agency `gmarkant@gmail.com` (the paid m a r k a n t lead agency); vendor
`gmarkant@icloud.com` (April Partner Test Agency). Use two browsers or a private window for the vendor.
**Data:** generic examples only. Create a throwaway project named `Budget test - spring launch` (client
`Example Client`) for the run, so nothing real is touched.

Each step says what to do and what you must see. Record a step as failed if what you see differs.

---

## Part A. Before 103 is applied (spine not enabled)

1. Sign in as the agency. In the sidebar, **00 Budgeting** shows "Coming soon", is not a link and is
   not focusable with Tab. Directly beneath it, **◆ Creative Treatment Analysis** IS a link (to
   `/agency/brief`) and is reachable with Tab (moved 2026-10-14; see Part D, NV1 to NV4).
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
    share of total · y% markup on cost", Margin (actual) likewise. Totals table: Fee total, Cost total,
    Project total, Margin (share of total), Markup on cost. Check by hand: margin amount = Fee total;
    share of total = fee / (fee + cost); markup on cost = fee / cost (see Part D, MG1 to MG5).
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
    - columns are Category, Line, Fee or cost, Kind, Kind source, Qty, Rate, Multiplier, Unit,
      Estimate, Actual, Estimate % of total, Actual % of total (the four math columns are empty for
      lines without a rate; Kind and Kind source are described in Part E, KE14);
    - the imported row 6 appears as `"Editorial","'=HYPERLINK(""http://example.com"",""click"")","cost","cost","inherited",...`
      (a leading single quote, quotes doubled);
    - the credit line's estimate is `"'-250.00"` (every cell starting with `-` is prefixed, including
      numbers);
    - after the lines come Fee total, Cost total, Project total, Margin (fee total), "Margin (share of
      total) %, fee / (fee + cost)" and "Markup on cost %, fee / cost"; then, after a blank row, one
      "(category total)" row per category (Part E, KE15).
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

## Part D. Line math (116), margin both ways, nav (feat/budget-line-math)

### Before 116 is applied (code deployed, columns missing)

LM0. **Not run - 116 applied before the browser test; covered by 116 pre-apply C19/C20.** (Was: Budget
     tab lines look exactly as before, with no Qty, Rate, x or Unit column and no formula hint; Budget
     CSV math columns present and empty.)
LM0b. **Not run - 116 applied before the browser test; covered by 116 pre-apply C19/C20.** (Was: import
     with a Rate column shows the "Line math is not enabled yet" note and saves computed totals as typed
     estimates.)

### After 116 is applied

LM1. Reload the Budget tab. Under the stop line a one-line hint reads "Total = Qty x Rate x multiplier,
     rounded to the cent. An empty Qty or x counts as 1. Leave Rate empty to type the total yourself."
     Each category shows column heads **Line, Qty, Unit, Rate, x, Total** in that order (F2: Unit sits
     directly after Qty), in the line rows and in the new-line row alike. After 117, a **Kind** head
     follows Total (Part E).
LM2. Existing lines show empty Qty, Rate, x and Unit and their typed Total, editable as before.
LM3. **Rate only:** in the new-line row type `Producer day`, Rate `950`, press Enter. Total 950.00
     (read-only, computed).
LM4. **Qty x rate:** new line `Shoot crew`, Qty `3`, Unit `day`, Rate `1250.50`: the Total cell shows
     3,751.50 while typing; Enter saves it. After the save the Rate cell reads **1,250.50** (F1: thousands
     separators, like Total; typing `1250.50` or `1,250.50` are both accepted). Hover the Total:
     "3 day x 1,250.50 = 3,751.50".
LM5. **Qty x rate x multiplier, and Tab order:** click `Shoot crew`'s Qty and press Tab repeatedly:
     focus moves **Unit, Rate, x** in that order (F2: Tab follows the visual order), then past the
     computed Total to the Kind chip (after 117) or the Archive button. Set x to `1.5` and press Tab:
     Total 5,627.25. Click Unit, type `shoot day`, press Tab: focus moves to Rate and Unit keeps `shoot
     day` (it saves on blur).
LM6. **Rounding:** new line `Rounding check`, Qty `0.125`, Rate `0.20`: Total 0.03 (half away from zero).
LM7. **Discount:** new line `Volume discount`, Qty `2`, Rate `-150`, x `1.5`: Total -450.00.
LM8. **Refusals:** on any line type Qty `0` -> "Quantity must be greater than 0" and the cell reverts; x
     `-1` -> refused; Qty `1.2345` -> "more than three decimal places"; Unit `abcdefghijklmnopqrstuvwxy`
     (25 characters) cannot be typed past 24; Rate `999999999999.99` with Qty `2` -> "The line total is
     too large...". Escape in any cell reverts it without saving.
LM9. **Clearing the rate keeps the total:** clear `Shoot crew`'s Rate and press Enter. Total stays
     5,627.25 and becomes an editable input; Qty, x and Unit stay. Type `5000` in Total: it saves
     5000.00. Set Rate `1250.50` again: Total returns to 5,627.25.
LM10. **R1 on a computed line:** bin icon on `Producer day` (950.00): refused with the R1 text and
     **Archive instead**. Set its Rate to `0`: Total 0.00; delete it: it is gone.
LM11. **Import with math:** save as `budget-math-sample.csv`:

```csv
Description,Category,Qty,Unit,Rate,x,Amount
Gaffer,"Camera, lighting and grip",3,day,850,1.5,
Grip truck,"Camera, lighting and grip",2,day,400,,800
Location permit,Locations and permits,,,,,1200
Overtime check,"Camera, lighting and grip",1.2345,hour,100,,
Agency fee,Creative development,1,flat,5000,,4000
```

     Import: the mapping guesses Quantity (Qty), Unit, Rate, Multiplier (x) and Amount; Amount reads
     "Amount (optional with a rate)". Review: Gaffer 3,825.00 with "3 day x 850.00 x 1.5"; Grip truck
     800.00; Location permit 1,200.00 (no rate, amount used); Overtime check excluded with "Quantity has
     more than three decimal places"; Agency fee 5,000.00 with "File amount 4,000.00 replaced by Qty x
     Rate x multiplier". Import the four included rows; the Budget tab shows their Qty, Rate, x and Unit.
LM12. **Export:** Budget CSV now has Qty, Rate, Multiplier, Unit filled for the computed lines
     (`"3"`, `"850.00"`, `"1.5"`, `"day"` for Gaffer) and empty for typed ones; the discount line's rate
     reads `"'-150.00"` (formula neutralisation, as for every cell starting with `-`).
LM13. **Vendor:** as `gmarkant@icloud.com`, any `/api/agency/budget/...` URL still answers 402 (or
     403/404) and the vendor UI shows no budget lines anywhere.

### Margin both ways

MG1. Summary tab: each margin card reads "x% share of total · y% markup on cost" (or "...: n/a", MG4).
MG2. Totals table: rows **Margin (share of total)** and **Markup on cost**, with Estimate and Actual.
MG3. By hand from Fee total F and Cost total C: share = F / (F + C); markup = F / C; one decimal.
MG4. In a project whose budget has only fee categories (cost 0): the card reads "100.0% share of total ·
     markup on cost: n/a" (F3: an undefined ratio reads "<name>: n/a" in a card, never a leading "-"
     that looks like a bullet); the table's Markup on cost shows `-`. A project with no lines: the card
     reads "share of total: n/a · markup on cost: n/a" and the table shows `-` for both.
MG5. Budget CSV: rows "Margin (share of total) %, fee / (fee + cost)" and "Markup on cost %, fee /
     cost", the same numbers as the Summary tab; `-` (written `'-`) where the tab shows `-`; Actual empty
     when there is no ledger.

### Nav

NV1. Agency sidebar, desktop: **00 Budgeting** has **◆ Creative Treatment Analysis** indented directly
     beneath it. Hover **01 RFP Broadcast**: its dropdown lists only Lightning RFP Magic Link.
NV2. Click **Creative Treatment Analysis**: `/agency/brief` opens exactly as before; the sub-link shows
     the active (lime) state.
NV3. Mobile width (under 768px): the same sub-link sits under 00 Budgeting; the RFP Broadcast inline list
     shows only Lightning RFP Magic Link.
NV4. With the spine probe failing (Part A conditions), 00 Budgeting is "Coming soon" text and the
     Creative Treatment Analysis sub-link still works.

## Part E. Line kind (117), percentages, F1-F3 (feat/budget-line-kind)

Rulings R-K1 (a line inherits its category's fee or cost unless it overrides it; every total sums by
the line's effective kind), R-K2 (percentages of the project total, never a line computed from other
lines) and R-K3 (each category's share of the project total).

**Use a fresh throwaway project** so the numbers below are exact: `Budget test - line kind` (client
`Example Client`). Percentages are one decimal.

KE0. **Setup.** Budget tab, empty chart: add category `Creative development` (choose **Fee**
     deliberately; the select starts at Cost under R-D1) and `Production crew` (leave Cost). Lines: Creative development `Concept`, no rate, Total `3000`. Production crew
     `Crew day`, Qty `2`, Rate `1000` (Total 2,000.00); `Producer markup`, no rate, Total `500`.

### Before 117 is applied (code deployed, column missing)

KB1. Budget tab: column heads Line, Qty, Unit, Rate, x, Total; **no Kind column, no chip**; the hint has
     no sentence about chips. Nothing errors.
KB2. Summary: Fee total 3,000.00 (54.5%), Cost total 2,500.00 (45.5%), Project total 5,500.00 (100.0%),
     in the Estimate "% of total" column. By category: Creative development FEE 3,000.00 54.5%;
     Production crew COST 2,500.00 45.5%. No line chip, no Mixed.
KB3. Import: the mapping step has **no** "Kind, per line" select. "Category fee or cost (optional)" is
     still there.
KB4. Budget CSV: every line's Kind equals its category's Fee or cost, Kind source `inherited`.
KB5. (Optional, DevTools console) `fetch(location.origin + "/api/agency/budget/projects/<project id>/lines/<Producer markup id>", {method: "PATCH", headers: {"Content-Type": "application/json"}, body: JSON.stringify({kind: "fee"})}).then(r => r.json())`
     answers 400 "Fee or cost per line is not enabled yet. The line follows its category." and
     nothing changes.

### After 117 is applied

KE1. **The chip.** Reload. A **Kind** head follows Total. Each line shows its effective kind as a small
     chip, **dashed outline, no fill** (inherited): Concept FEE (lime), Crew day and Producer markup
     COST. The new-line row shows a dashed chip of its category's kind. The hint ends "Each line follows
     its category's fee or cost (dashed chip). Click a dashed chip to set the line to the other kind
     (solid chip); click a solid chip to follow the category again." (R-K4 wording.)
KE2. **Override.** Click Producer markup's chip: it turns **solid FEE**, and a small reset icon appears
     beside it (hover: "Reset to category (cost)"). The Production crew header total stays **2,500.00**
     (the sum of all its lines, whatever their kind).
KE3. **Summary by effective kind.** Fee total 3,500.00, **63.6%**; Cost total 2,000.00, **36.4%**;
     Project total 5,500.00, **100.0%**. Margin (estimate) 3,500.00, "63.6% share of total · 175.0%
     markup on cost"; the table's Margin (share of total) 63.6% and Markup on cost 175.0%. By
     category: Production crew shows **MIXED**, 2,500.00, 45.5%, then rows **Fee part** 500.00 and
     **Cost part** 2,000.00, then its lines: Crew day dashed COST, Producer markup solid FEE. Creative
     development: FEE, 3,000.00, 54.5%, Concept dashed FEE.
KE4. **Toggle again (R-K4).** Click Producer markup's solid FEE chip: it returns to **dashed COST**
     (inherit; an override can never equal its category) and the reset icon is gone. Summary: Fee
     3,000.00 (54.5%), Cost 2,500.00 (45.5%); Production crew is COST, not Mixed.
KE5. **Reset to category.** Click the chip again (solid FEE), then click the reset icon: the chip is
     **dashed COST** and the icon is gone. Budget CSV: Producer markup Kind source `inherited`.
KE6. **A kind change never moves a number.** Click Crew day's chip (it has a rate): solid FEE. Its
     Qty 2, Rate 1,000.00 and Total 2,000.00 are unchanged (116's trigger recomputes the same
     estimate; 117 pre-apply K10/K11). Reset it.
KE7. **Category flip.** Set Producer markup to FEE again (solid). On Production crew click the switch
     icon ("Mark as fee") and confirm. Crew day's chip is now **dashed FEE** (an inherited line moves
     with its category); Producer markup is also **dashed FEE**: R-K4 cleared its FEE override because
     it now equals the category (the switch is a merge, and the server sweeps the survivor). Summary:
     Fee 5,500.00 (100.0%), Cost 0.00 (0.0%); the Margin (estimate) card reads "100.0% share of total ·
     markup on cost: n/a" (F3) and the table's Markup on cost shows `-`. Switch Production crew back
     to cost: Crew day **and Producer markup** dashed COST (the override did not survive the round
     trip, by design), Production crew COST, not Mixed. Click Producer markup's chip: solid FEE;
     Production crew Mixed, Fee 3,500.00 and Cost 2,000.00 again.
KE8. **Actual by effective kind.** Ledger tab: add a manual entry 600.00, payee `Example Talent Co`,
     category Production crew, line **Producer markup**; and one of 200.00, payee `Example Rentals Co`,
     category Production crew, no line. Summary: Actual Fee 600.00 (**75.0%**), Cost 200.00
     (**25.0%**), Project total 800.00 (100.0%). Margin (actual) 600.00, "75.0% share of total ·
     300.0% markup on cost". Production crew Actual 800.00, 100.0%; Fee part Actual 600.00, Cost part
     Actual 200.00. Creative development Actual 0.00, 0.0%.
KE9. **An entry on an archived line keeps that line's kind.** Archive Producer markup. Summary
     Estimate: Fee 3,000.00, Cost 2,000.00, total 5,000.00. Actual is unchanged: Fee 600.00, Cost 200.00;
     Production crew shows "Not on a line (2 entries)" 800.00 and is still Mixed (Fee part Actual
     600.00). Restore Producer markup (it is still solid FEE).
KE10. **Negative share.** Add category `Discounts` (Cost) with line `Volume discount`, Total `-1000`.
     Summary Estimate: Fee 3,500.00 (77.8%), Cost 1,000.00 (22.2%), Project total 4,500.00 (100.0%). By
     category: Discounts -1,000.00, **-22.2%** (negative, not hidden); Production crew 2,500.00, 55.6%;
     Creative development 3,000.00, 66.7%.
KE11. **"-" only on a zero total.** In a second throwaway project with categories and no lines (or all
     lines at 0): every "% of total" cell, Project total's included, shows `-`. In this project no
     percentage shows `-` while the total is not 0.
KE12. **Import with a Kind column.** Save as `budget-kind-sample.csv`:

```csv
Description,Category,Amount,Kind
Retouching,Production crew,400,
Account lead,Production crew,700,FEE
Usage buyout,Production crew,900,Cost
Bad kind row,Production crew,100,margin
```

     Import: the mapping guesses **Kind, per line: fee or cost** = Kind (and does not use it for
     "Category fee or cost"); a note explains the difference. Review has a **Line kind** column:
     Retouching "Category"; Account lead solid FEE; Usage buyout solid COST; Bad kind row **excluded**,
     status "Excluded: Kind "margin" is not fee or cost" (ticking it shows the same reason and blocks
     Import). Import the three: Budget tab chips Retouching dashed COST, Account lead solid FEE, Usage
     buyout **dashed COST** (R-K4: the server stores a Kind equal to the category as inherit; the
     review still shows the file's value).
KE13. **Budget CSV, per line.** Columns Category, Line, Fee or cost, Kind, Kind source, Qty, Rate,
     Multiplier, Unit, Estimate, Actual, Estimate % of total, Actual % of total. Concept `fee`, `fee`,
     `inherited`; Producer markup `cost`, `fee`, `override`; Usage buyout `cost`, `cost`, `inherited`
     (R-K4);
     Retouching `cost`, `cost`, `inherited`; Volume discount estimate `"'-1000.00"`. Production crew's
     "(not on a line)" row: Kind `cost`, Actual 200.00. Line rows leave both % cells empty.
KE14. **Budget CSV, totals and categories (same numbers as the Summary tab).** Fee total 4,200.00,
     `64.6`, Actual 600.00, `75.0`; Cost total 2,300.00, `35.4`, 200.00, `25.0`; Project total
     6,500.00, `100.0`, 800.00, `100.0`. After a blank row, one "(category total)" row per category:
     Production crew `mixed`, 4,500.00, `69.2`, 800.00, `100.0`, followed by "(fee part)" 1,200.00 /
     600.00 and "(cost part)" 3,300.00 / 200.00; Creative development `fee`, 3,000.00, `46.2`;
     Discounts `cost`, -1,000.00 (written `"'-1000.00"`), `'-15.4`. Compare each with the Summary tab.
KE15. **Ledger CSV.** "Fee or cost" is the entry's effective kind: the 600.00 entry on Producer markup
     reads `fee`; the 200.00 entry reads `cost`.
KE16. **F1, Rate formatting.** On any rated line type Rate `1250.50` and press Enter: the cell reads
     **1,250.50**; hover the Total: the formula shows 1,250.50. Import review (any file with a Rate of
     `1250.50` and no Qty; cancel after review): the formula under the amount reads "1 x 1,250.50".
     Typing `1,250.50` into a Rate cell is accepted.
KE17. **F2, column order and Tab.** Line rows and the new-line row both read Line, Qty, Unit, Rate, x,
     Total, Kind. In the new-line row, Tab from the name goes Qty, Unit, Rate, x, Total (when no rate),
     then Add.
KE18. **F3, margin cards.** Covered by KE7 and MG4: an undefined ratio in a card reads "markup on cost:
     n/a" or "share of total: n/a"; the tables keep `-`.
KE19. **Vendor and anon.** As the vendor, `/api/agency/budget/projects/<id>/lines` answers 402 (or
     403/404), never lines or kinds. The database side is 117 pre-apply KV1-KV3 and KA1-KA3.
KE20. **Rollback (do not run in the test).** `117_budget_line_kind_down.sql` refuses while any override
     exists; forced, it deletes every override and every line follows its category again.

### Kind defaults, R-K4, R-D3, F5 (feat/budget-kind-defaults)

Owner rulings 2026-10-14: **R-D1** cost is the default for every new category; **R-D2** starter
re-tag; **R-K4** an override equal to the category's kind is stored as NULL (inherit), on the server;
**R-D3** re-tag the owner's test project and its organization's template. Use the KE project unless
stated.

**R-D1, one entry point at a time (a new category starts as cost):**

KD1. **Template editor** (`/agency/budgeting/templates`, Add a category): the Fee or cost select shows
     **Cost (third-party spend)** before anything is touched, and there is no empty "Fee or cost?"
     choice. Type `KD template cost`, press Add category: it is listed as Cost. Add `KD template fee`
     after choosing Fee: Fee. After each add the select is back at Cost. Delete both.
KD2. **Project chart** (Budget tab, Add a category): the select starts at **Cost**; adding
     `KD chart cost` without touching it gives a COST category; the select returns to Cost after an
     add. Name empty: "Name the category." Archive the category afterwards.
KD3. **Import, empty category cell.** Save as `budget-kd-defaults.csv`:

```csv
Description,Category,Amount,Fee or cost
Kd a,KD new empty,100,
Kd b,KD new junk,100,maybe
Kd c,KD new fee,100,fee
Kd d,KD new fee,100,
Kd e,KD new nocol,100,
```

     Map "Category fee or cost" to the Fee or cost column. Review: KD new empty **Cost**, KD new junk
     **Cost** (an unreadable cell is treated as empty), KD new fee **Fee** on both rows (a deliberate fee
     on any row of a new category wins), KD new nocol **Cost**. The Fee or cost select on new-category
     rows has no "Choose..." option. Run it again with the "Category fee or cost" mapping left empty:
     every new category is Cost. Choose "New category..." on a row and type a name: Cost; type the
     name `KD new fee`: the row adopts **Fee** on blur. Cancel without importing (or import and
     archive).
KD4. **Composer** (`/agency/budgeting/templates`, Compose from starters): see R-D2 below; every
     pre-selected flag is the starter's, so only deliberate starter fees arrive as fee.
KD5. **AI suggestions** (import review, Suggest categories; needs the AI entitlement): rows such as
     `Agency management fee 10%`, `Producer (agency staff) 3 days`, `Concept and scripting`,
     `Photographer day rate`, `Stock music licence`. Expect FEE only for the first two; everything else,
     and anything ambiguous, COST. Rows suggested into an existing category take that category's flag.
     (The instruction text is in `suggest-categories/route.ts`; a model may still disagree, so this is
     a spot check, not an exact assertion.)

**R-D2, composer fee counts.** In "Compose from starters", each starter card reads:

| Starter | Card |
|---|---|
| Live-action video production | 21 categories · 2 fee |
| Experiential and live event | 19 categories · 2 fee |
| Digital and social campaign | 12 categories · 1 fee |
| Photo shoot | 14 categories · 1 fee |
| Animation and post-production | 14 categories · 1 fee |
| Agency retainer | 6 categories · 2 fee |
| Brand identity and design | 9 categories · 5 fee |
| Audio and podcast production | 9 categories · 1 fee |

KD6. Tick all eight, Choose categories: Creative development, Event strategy and creative, Strategy
     and planning, Creative and copywriting, Design and art direction, Community management, Reporting
     and analytics, Art direction, Creative direction and Series development show **Cost**. Agency
     production fee, Producer and production management, Agency management fee, On-site event staff
     (agency), Paid media management fee, Agency project management, Monthly retainer fee, Additional
     scope fees, Producer and showrunner (agency), Research and discovery, Brand strategy, Identity
     design, Brand guidelines and Copywriting and naming show **Fee** (names already in your template
     are greyed with their stored badge instead). Preview: "N categories ... F fee, C cost" matches.
     Back out without adding.

**R-K4, chip behaviour (KE project, Production crew is COST, Creative development is FEE):**

KD7. **Dashed sets the other kind.** Crew day dashed COST: click it, **solid FEE**, reset icon shown.
KD8. **Solid returns to inherit.** Click the solid FEE chip: **dashed COST**, icon gone. Hover title
     on a solid chip: "fee, set on this line. Click: Follow the category (cost)."
KD9. **Reset to category kept.** Make Crew day solid FEE again and use the reset icon: dashed COST.
KD10. **The server refuses to store a redundant override.** DevTools console:
     `fetch(location.origin + "/api/agency/budget/projects/<project id>/lines/<Crew day id>", {method: "PATCH", headers: {"Content-Type": "application/json"}, body: JSON.stringify({kind: "cost"})}).then(r => r.json())`
     answers 200 with `line.fee_or_cost: null`. Same with POST `/lines` and `kind: "cost"` into
     Production crew: the new line has `fee_or_cost: null`.
KD11. **Category of another project is 404.** PATCH Crew day with `{categoryId: "<a category id of a
     different project of yours>"}` and, separately, POST `/lines` with that categoryId: both **404
     "Category not found"**; nothing changes in either project.
KD12. **Move.** Make Producer markup solid FEE. Using DevTools, PATCH it with
     `{categoryId: "<Creative development id>"}`: it lands in Creative development (FEE) as **dashed
     FEE** (`fee_or_cost: null`). Move it back with `{categoryId: "<Production crew id>"}`: dashed COST
     (the override is gone, as R-K4 requires). Make it solid FEE again.
KD13. **Merge.** Add category `KD merge source` (Fee) with line `KD fee line` and click its chip to
     solid COST; add line `KD plain line` (dashed FEE). Merge KD merge source into **Production crew**
     (COST): `KD fee line` arrives **dashed COST** (its COST override equalled the survivor and was
     cleared); `KD plain line` arrives dashed COST (inherits). The merge response carries
     `lineKindsReset: 1`. Archive the two lines.
KD14. **Rename and switch** are merges, so KE7 above covers the switch; a rename leaves every chip as
     it was (same kind, nothing to clear).

**F5, typed Total:**

KD15. On a line with no rate type Total `3751.5` and press Tab: the cell reads **3,751.50**. Click
     into it: **3751.50** (raw, editable). Escape: back to 3,751.50. Typing `1,234.5` is accepted and
     shows 1,234.50. A rated line's Total (computed, not editable) and Rate are unchanged (F1).

**R-D3, data fix for the owner's test project** (`e533075f-95f0-414e-bbca-742c7d344aad`, organization
`79a82f92-c2bd-42ab-90a8-0b4d54f9e043`). Supabase SQL Editor, in this order:

KD16. **Preview** `supabase/data-fixes/2026-10-14-retag-categories_preview.sql` (read only). Check:
     the scope row says "equals ...: YES"; the category rows are only the ten R-D2 names, each `fee` ->
     `cost`, in `budget_project_categories` (this project) and `budget_template_categories` (this
     organization); the count rows are at most 10 per category table; the "outside" rows show the
     other projects and organizations that match, untouched. **Save the whole output** (download CSV):
     the override rows are the only record of what the apply clears.
KD17. **Dry run.** In `2026-10-14-retag-categories_apply.sql` change line **181** `COMMIT;` to
     `ROLLBACK;` and run. The summary rows must equal the preview counts (project categories, template
     categories, overrides cleared). Any RAISE (F1-F7) means stop. Restore line 181 to `COMMIT;`.
KD18. **Apply.** Run the apply unchanged. Same summary as the dry run.
KD19. **Verify.** Run the preview again: no category rows, no override rows, counts 0, the outside
     counts unchanged. Budget tab of the test project: the ten names show COST, no solid chip equals
     its category. Template page: the same names show Cost. Another project and another
     organization's template are unchanged.
KD20. **Revert (only if needed).** `2026-10-14-retag-categories_revert.sql` (COMMIT line 181) sets the
     same names in scope back to fee; it does NOT restore cleared overrides (use the saved preview
     output) and also sets to fee any of those names that were cost before the apply.

## Cleanup

61. Archive the test project's lines and categories, or leave the test project in place; ledger entries
    cannot be deleted by design (R2), only voided.
