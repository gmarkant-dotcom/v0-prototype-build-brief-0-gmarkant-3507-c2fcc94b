-- =====================================================================
-- REPAIR: partner_rfp_inbox.agency_company_name, stale snapshots.
--
-- THIS IS NOT A MIGRATION. It lives in docs/ deliberately and must not be
-- moved to supabase/migrations/. It changes DATA, not schema; it is not
-- part of the numbered sequence; a rebuilt database would not want it; and
-- it is Greg's to run, once, by hand, after reading section 0.
--
--   CHANGES   public.partner_rfp_inbox.agency_company_name
--   ROWS      unknown until section 1 runs. NOT MEASURED - see below.
--   SCHEMA    none. POLICIES: none. FUNCTIONS: none. TRIGGERS: none.
--
-- =====================================================================
-- STOP GATE. GREG RUNS THIS. THE AGENT DOES NOT.
-- =====================================================================
--
-- Authored 2026-08-25 by a session with no database access, which executed
-- no statement against anything and holds no credential that could.
--
-- >>> SECTION 0 IS A PRODUCT QUESTION AND THIS FILE DOES NOT ANSWER IT.
-- >>> READ IT BEFORE RUNNING SECTION 2. If the answer is "leave history
-- >>> alone", this file is the wrong tool and running it is not reversible
-- >>> in any useful sense: the values it overwrites are the only record of
-- >>> what those names were.
--
-- =====================================================================
-- WHAT IS WRONG, established 2026-08-21
-- =====================================================================
--
-- `partner_rfp_inbox.agency_company_name` is a DENORMALIZED SNAPSHOT of the
-- lead agency's name, stamped when the row is written and never re-read:
--
--   app/api/agency/broadcast-rfp/route.ts:242 and :387   (standard broadcast)
--   lib/magic-token-attach.ts:338                        (magic-link attach)
--
-- The vendor's Open RFPs screen GROUPS BY THAT STRING, not by the id:
--
--   components/partner-rfp-surface.tsx:514
--     const key = groupBy === "agency"
--       ? (r.agency_company_name || "Unknown Agency").trim()
--
-- So two spellings of one company are two groups by construction, and the
-- header at :519 counts groups. That is how markant's vendor portal showed
-- "96 RFPs across 2 agencies" - including one group named "April Test Greg
-- Lead Agency" - while every one of those 96 rows carries a single
-- `lead_org_id`. The organization was renamed; the snapshots were not.
--
-- THE WRITERS WERE REPAIRED EARLIER. HISTORY WAS NOT. That is what this
-- file is for, and it is the whole of what it is for.
--
-- =====================================================================
-- SECTION 0. THE PRODUCT QUESTION. NOT ANSWERED HERE.
-- =====================================================================
--
-- >>> A SNAPSHOT RECORDS WHAT WAS TRUE WHEN THE RFP WAS SENT. Overwriting
-- >>> it with today's name makes a two-year-old RFP claim it came from a
-- >>> company under a name that did not exist then.
--
-- That is not a bug in this file. It is the thing the file does, and it is
-- a choice between two defensible products:
--
--   (A) THE SNAPSHOT IS A HISTORICAL RECORD. Keep it. An RFP shows the name
--       the agency traded under at the time, the way an invoice does.
--       COST: the vendor's screen keeps splitting one agency into several,
--       the count in the header stays wrong, search by agency name keeps
--       missing rows, and every future rename adds another false group.
--       The defect that prompted this file is not fixed and gets worse on
--       a schedule nobody controls.
--       ALSO: nothing in the product presents this field AS history. There
--       is no "sent as" label, no date qualifier, no tooltip. A user
--       reading two group headers does not conclude "this company was
--       renamed"; they conclude they have two agencies. So the historical
--       value is currently being PRESERVED AND NOT COMMUNICATED, which is
--       the worst of both.
--
--   (B) THE SNAPSHOT IS A CACHE OF THE CURRENT NAME. Refresh it. This file.
--       COST: the historical name is DESTROYED. There is no second copy -
--       `organizations` holds only the current name, and there is no
--       rename audit table anywhere in this schema (grep: no
--       organization_renames, no history table, no trigger on
--       organizations.name). After this runs, nothing in the database knows
--       the agency was ever called anything else.
--       ALSO: it fixes today and drifts again on the next rename. This file
--       has to be re-run after every one, forever, and nobody will remember.
--
--   (C) THE OPTION THIS FILE DOES NOT IMPLEMENT, mentioned because it is
--       probably the right one and choosing (A) or (B) forecloses noticing
--       it: STOP GROUPING BY THE STRING. `/api/partner/rfps` already
--       batch-loads `organizations` for the meeting link
--       (app/api/partner/rfps/route.ts:195-209), so the join is already
--       being made on that request. Grouping by `lead_org_id` and taking
--       the label from that batch makes the drift UNRENDERABLE rather than
--       repaired, leaves the snapshot intact as history, and needs no SQL.
--       COST: it changes what a vendor sees for an agency they have no
--       partnership with, because the organization would not resolve and
--       the label would fall back. That is a product ruling, which is why
--       it is not in this file either.
--
-- >>> IF (C) IS THE ANSWER, DO NOT RUN SECTION 2 AT ALL. It would destroy
-- >>> the historical names to fix a symptom that (C) removes without them.
--
-- (B) AND (C) ARE NOT MUTUALLY EXCLUSIVE, and the ordering matters: (C)
-- first makes (B) unnecessary; (B) first makes (C) cheaper to get wrong,
-- because the drift it would have exposed is gone.
--
-- =====================================================================
-- HOW TO RUN IT
-- =====================================================================
--
--   1. RUN SECTION 1 ALONE FIRST. It is read-only. It tells you how many
--      rows are affected and, more usefully, WHICH NAMES they carry. Do not
--      skip to section 2 on the count alone - a count cannot tell a rename
--      apart from a value that is legitimately different.
--   2. Read section 0 against what section 1 returned.
--   3. Only then paste section 2 as one batch.
--
-- >>> IT MUST RUN AS THE SERVICE ROLE OR AS postgres, AND THIS IS THE ONE
-- >>> THING MOST LIKELY TO GO WRONG SILENTLY.
--
-- `partner_rfp_inbox` has FIVE policies and only ONE of them is an UPDATE:
-- "Partners update own inbox rows", keyed on the VENDOR side. There is no
-- agency-side UPDATE policy on this table at all. So an agency session
-- running section 2 matches ZERO rows, changes nothing, and the Supabase
-- SQL Editor reports success.
--
-- >>> "Success. No rows returned" IS WHAT THE EDITOR SAYS FOR A DRY RUN,
-- >>> FOR A REAL RUN, FOR A RUN THAT MATCHED NOTHING BECAUSE ROW LEVEL
-- >>> SECURITY FILTERED IT ALL OUT, AND FOR A QUERY PASTED INTO THE WRONG
-- >>> TAB. It distinguishes none of those. Section 3 is what tells them
-- >>> apart, and it is not optional.
--
-- TRANSACTION CONTROL. Section 2 carries an explicit BEGIN; on LINE 202 and
-- an explicit COMMIT; on LINE 272. Those are the only executable
-- occurrences of either word in this file.
--
-- TO DRY RUN: change the COMMIT; on line 272 to ROLLBACK; and run sections
-- 1 and 2 together. Every statement executes, the assertion block below
-- fires if it is going to, and nothing persists. Verify the line numbers
-- before trusting them, with:
--
--     grep -n -i '^begin\|^commit\|^rollback' docs/inbox-name-backfill.sql
--
-- THAT GREP RETURNS THREE HITS, AND THREE IS CORRECT:
--     202  BEGIN;    <- executable. The transaction.
--     212  BEGIN     <- plpgsql, the assertion block's body. No semicolon;
--                       matched by the case-insensitive form only, not a
--                       transaction statement.
--     272  COMMIT;   <- executable. Change this one to ROLLBACK; to dry run.
--
-- IT IS IDEMPOTENT. The predicate is `IS DISTINCT FROM`, so a second run
-- matches zero rows and is a no-op. Running it twice is harmless; running
-- it after a later rename picks up only what that rename drifted.
--
-- =====================================================================


-- =====================================================================
-- SECTION 1. THE COUNT, BEFORE ANYTHING CHANGES. READ ONLY.
-- Run this alone. Both queries. Read the second one.
-- =====================================================================

-- 1a. THE HEADLINE NUMBERS.
--
-- IS DISTINCT FROM, never <>. Rows with a NULL snapshot exist - the
-- magic-link path wrote NULL before its own fix - and `NULL <> 'x'` is
-- NULL, which is not true, so <> would silently skip exactly the rows most
-- in need of repair.
SELECT count(*)                                              AS drifted_rows,
       count(*) FILTER (WHERE i.agency_company_name IS NULL) AS null_snapshots,
       count(DISTINCT i.lead_org_id)                         AS organizations_affected,
       count(DISTINCT i.agency_company_name)                 AS distinct_stale_names
  FROM public.partner_rfp_inbox i
  JOIN public.organizations o ON o.id = i.lead_org_id
 WHERE i.agency_company_name IS DISTINCT FROM o.name;

-- 1b. >>> THE ONE THAT ACTUALLY INFORMS THE DECISION. <<<
--
-- A count cannot tell a RENAME apart from a value that is legitimately
-- different. This shows every stale spelling beside the current name, with
-- how many rows carry it and how old they are. Read it before section 2.
--
-- If a row here looks like a DIFFERENT COMPANY rather than an older name
-- for the same one, stop: that is not drift, and overwriting it would
-- destroy a correct value.
SELECT i.lead_org_id,
       o.name                                       AS current_org_name,
       coalesce(i.agency_company_name, '<NULL>')    AS stale_snapshot,
       count(*)                                     AS rows,
       min(i.created_at)                            AS oldest,
       max(i.created_at)                            AS newest
  FROM public.partner_rfp_inbox i
  JOIN public.organizations o ON o.id = i.lead_org_id
 WHERE i.agency_company_name IS DISTINCT FROM o.name
 GROUP BY 1, 2, 3
 ORDER BY rows DESC, oldest;


-- =====================================================================
-- SECTION 2. THE REPAIR. Run only after section 0 is settled.
-- =====================================================================

BEGIN;

-- THE PRE-COUNT, CAPTURED INSIDE THE TRANSACTION so the assertion below
-- compares like with like. A separate query run beforehand could be stale
-- by the time this runs; this cannot be.
DO $repair$
DECLARE
  v_before integer;
  v_after  integer;
  v_written integer;
BEGIN
  SELECT count(*) INTO v_before
    FROM public.partner_rfp_inbox i
    JOIN public.organizations o ON o.id = i.lead_org_id
   WHERE i.agency_company_name IS DISTINCT FROM o.name;

  UPDATE public.partner_rfp_inbox i
     SET agency_company_name = o.name
    FROM public.organizations o
   WHERE o.id = i.lead_org_id
     AND i.agency_company_name IS DISTINCT FROM o.name;
  GET DIAGNOSTICS v_written = ROW_COUNT;

  SELECT count(*) INTO v_after
    FROM public.partner_rfp_inbox i
    JOIN public.organizations o ON o.id = i.lead_org_id
   WHERE i.agency_company_name IS DISTINCT FROM o.name;

  -- >>> THE ASSERTION THAT MAKES "Success. No rows returned" MEAN SOMETHING.
  --
  -- Three ways this repair fails silently, and this catches all three:
  --   * ROW LEVEL SECURITY FILTERED EVERYTHING OUT. v_before > 0 and
  --     v_written = 0. This is the failure mode of running as an agency
  --     session instead of the service role, and without this line it looks
  --     exactly like success.
  --   * THE UPDATE MATCHED BUT DID NOT STICK. v_after > 0 after a write.
  --   * THERE WAS NOTHING TO DO. v_before = 0, which is a legitimate and
  --     quiet outcome, and is allowed through.
  IF v_before > 0 AND v_written = 0 THEN
    RAISE EXCEPTION
      'REPAIR REFUSED: % rows are drifted and the UPDATE wrote 0. Row level security filtered them out - partner_rfp_inbox has no agency-side UPDATE policy. RE-RUN AS THE SERVICE ROLE OR AS postgres. Nothing has been changed.',
      v_before;
  END IF;

  IF v_after <> 0 THEN
    RAISE EXCEPTION
      'REPAIR INCOMPLETE: wrote % row(s) but % are still drifted. Do not commit. Investigate before retrying.',
      v_written, v_after;
  END IF;

  -- NO "SUCCESS" RAISE HERE, DELIBERATELY, AND IT IS WORTH SAYING WHY.
  --
  -- 093's PRE-APPLY TEST ends in RAISE EXCEPTION because it is a TEST: its
  -- whole job is to report and roll back, and an error is the only channel
  -- the Supabase SQL Editor renders. THIS IS NOT A TEST. It is the repair,
  -- and a repair that always aborted would need editing before it could do
  -- its job - which means the thing Greg runs would not be the thing that
  -- was reviewed.
  --
  -- So this block raises ONLY on the two failures above and is silent on
  -- success, the COMMIT below is real, and the dry run is the ordinary
  -- house toggle: change COMMIT; to ROLLBACK;.
  --
  -- The cost is that a successful run reports "Success. No rows returned"
  -- and tells you nothing. That is exactly why SECTION 3 IS NOT OPTIONAL,
  -- and why SECTION 1 must be run BEFORE this, not after: between them they
  -- are the before and after that this block cannot print.
END
$repair$;

COMMIT;


-- =====================================================================
-- SECTION 3. VERIFY AFTER APPLYING. READ ONLY.
--
-- >>> RUN THIS. The editor's success message distinguishes nothing.
-- =====================================================================
--
-- V1. NOTHING IS DRIFTED. Expected: 0.
--
--     SELECT count(*) AS still_drifted
--       FROM public.partner_rfp_inbox i
--       JOIN public.organizations o ON o.id = i.lead_org_id
--      WHERE i.agency_company_name IS DISTINCT FROM o.name;
--
-- V2. THE SYMPTOM IS GONE. One name per organization now.
--     Expected: every row shows distinct_names = 1.
--
--     SELECT lead_org_id, count(DISTINCT agency_company_name) AS distinct_names,
--            count(*) AS rows
--       FROM public.partner_rfp_inbox
--      GROUP BY 1
--      HAVING count(DISTINCT agency_company_name) > 1;
--
--     ANY ROW RETURNED HERE IS A REMAINING SPLIT. After a successful repair
--     this returns nothing at all.
--
-- V3. THE ROWS WITH NO ORGANIZATION, which this repair CANNOT touch and
--     which V1 does not see because it is an INNER JOIN.
--     Expected: unknown. Report it rather than assuming zero.
--
--     SELECT count(*) AS orphaned_rows
--       FROM public.partner_rfp_inbox i
--       LEFT JOIN public.organizations o ON o.id = i.lead_org_id
--      WHERE o.id IS NULL;
--
--     A non-zero count means inbox rows point at a lead_org_id with no
--     organization row. Those keep whatever snapshot they have, which is
--     the only name anything still knows for them. That is a separate
--     finding and NOT something to fix by widening this repair.
-- =====================================================================
