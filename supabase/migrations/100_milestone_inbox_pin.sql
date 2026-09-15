-- =====================================================================
-- Migration 100: the inbox-pinned branch on the vendor INSERT policy.
-- RULING 6. The only one of the nine that REPAIRS something broken.
--
-- =====================================================================
-- AUTHORED, NOT APPLIED. Greg runs this in the Supabase SQL Editor.
-- =====================================================================
--
-- Nothing in the session that wrote this file executed a single
-- statement against any database. There is no psql on PATH and every
-- POSTGRES_* credential in this environment is an empty string. Every
-- number below that describes live data is a QUESTION for the pre-flight
-- capture, never an observation.
--
-- TRANSACTION CONTROL. This file carries an explicit BEGIN on LINE 356
-- and an explicit COMMIT on LINE 528. They are the only executable
-- occurrences of either word; every other appearance is inside a comment.
--
-- TO DRY RUN: change the COMMIT; on line 528 to ROLLBACK; and run the
-- whole file. Every statement executes, every error surfaces, nothing
-- persists. Migration 086 shipped with NO transaction control at all, so
-- that same swap silently did nothing and what was believed to be a dry
-- run applied for real with no rollback available. Verify before
-- trusting:
--   grep -n '^BEGIN;$'  -> exactly one hit, line 356
--   grep -n '^COMMIT;$' -> exactly one hit, line 528
--
-- Sequence, in order, no step skipped:
--
--   1. Run the PRE-FLIGHT CAPTURE below. It has FIVE queries. P1 and P2
--      can each stop this migration outright. Read all five first.
--   2. Run supabase/migrations/100_preapply_test.sql. It applies this
--      policy inside a transaction, writes through it as a real vendor,
--      and rolls back. Its five mandatory assertions are the only thing
--      that proves this file rather than describing it.
--   3. READ "ORDERING AGAINST THE CODE". It is shorter than usual and
--      the answer is unusual: THERE IS NO CODE.
--   4. Dry run: swap COMMIT for ROLLBACK, run, confirm no errors.
--   5. Run this file for real. Expect "Success. No rows returned".
--   6. Run the VERIFICATION block at the foot.
--   7. Only then, update the migrations table in LIGAMENT_CONTEXT.md.
--
-- =====================================================================
-- WHAT IS BROKEN, MEASURED FROM SOURCE
-- =====================================================================
--
-- 088's vendor INSERT policy requires `partnership_id IS NOT NULL`. A
-- vendor who has not been added to the agency's pool has no partnerships
-- row, so the emitter resolves a null and the INSERT is refused with
-- 42501. `recordMilestone()` catches it, reports it to Sentry, and
-- returns void. The route succeeded, the vendor saw success, and neither
-- side has a row. The agency's feed shows an RFP sent and never shows it
-- opened, concentrated on exactly the vendors it knows least about.
--
-- >>> FOUR EMITTERS ARE AFFECTED, NOT FIVE. THE OWED DOC SAYS FIVE AND
-- >>> IS WRONG. <<<
--
-- docs/emitter-rulings-owed.md ruling 6 lists `rfp.view`,
-- `nda.acknowledge`, `bid.submit`, `bid.revise` and
-- `status_update.post`. The last one cannot reach this gate. Read
-- app/api/partner/projects/[projectId]/status-update/route.ts: it
-- returns 403 "No partnership" when the caller has none (:150), resolves
-- its assignment `.in("partnership_id", partnershipIds)`, and SKIPS the
-- emit outright when the partnership is not in the caller set (:300).
-- Its `partnership_id` is non-null by construction. A status update is a
-- post-award act and a post-award vendor has a partnership.
--
-- And of the four, the GUEST `bid.submit`
-- (app/api/rfp/guest/[token]/route.ts) is not affected either: that route
-- is service-role throughout and RLS is not enforced for the service key.
-- It already writes its row today. The affected set is the three portal
-- routes:
--
--   rfp.view          app/api/partner/rfps/[id]/route.ts
--   nda.acknowledge   app/api/partner/rfps/[id]/nda-notify/route.ts
--   bid.submit        app/api/partner/rfps/[id]/response/route.ts
--   bid.revise        the same route, later versions
--
-- =====================================================================
-- THE PIN: partner_rfp_inbox, AND NOT rfp_magic_tokens
-- =====================================================================
--
-- Greg's ruling. Three reasons, all checkable:
--
--   1. IT IS THE ROW THE VENDOR IS ACTING ON. All four affected emits
--      happen because an inbox row exists and the vendor opened, signed
--      against, or bid on it. `rfp_magic_tokens` is the record of an
--      invitation, which is a different fact.
--   2. IT CARRIES lead_org_id, and 079:987 made that column NOT NULL. It
--      is the column that pins `org_id`, which is the whole job (see
--      below).
--   3. THE EXISTS MATCHES POLICIES ALREADY LIVE ON THAT TABLE.
--      "Partners select inbox rows by partner_id" is
--      `USING (vendor_org_id IN (SELECT public.current_user_org_ids()))`
--      (079:1352). The branch below proves the same relationship the same
--      way. This is not a new shape of proof.
--
-- =====================================================================
-- THE CONSTRAINT THAT CANNOT BE SKIPPED, AND IS NOT
-- =====================================================================
--
-- `partnership_id IS NOT NULL` in 088 is what makes its EXISTS reachable,
-- and 088's own header calls that EXISTS "the clause that matters most".
-- Its second job is the one that is easy to miss: IT PINS org_id.
-- Nothing else in 088 constrains org_id at all, and org_id is exactly
-- what the agency's SELECT policy reads. Without a pin a vendor could
-- write vendor_org_id = their own organization, passing every other
-- test, and org_id = ANY organization id they can obtain - producing a
-- line the vendor composed on an arbitrary agency's dashboard, which
-- lib/activity-feed.ts renders into the line text. That is feed
-- injection.
--
-- >>> SO DROPPING THE NULL CHECK ALONE WOULD REOPEN THE HOLE 088 EXISTS
-- >>> TO CLOSE. THIS FILE DOES NOT DROP IT. <<<
--
-- `partnership_id IS NOT NULL` survives VERBATIM inside branch A, with
-- its EXISTS unchanged character for character. Branch B does not remove
-- a proof, it SUBSTITUTES one: org_id is pinned to an agency that has
-- demonstrably addressed an inbox row to the caller's own organization.
--
-- =====================================================================
-- THE NEW PIN IS AN ALTERNATIVE BRANCH, NOT A REPLACEMENT
-- =====================================================================
--
-- The full predicate, after this file. Everything above the parenthesis
-- is 088 unchanged; the parenthesis is the only thing this file adds.
--
--   actor_side = 'vendor'
--   AND actor_id = auth.uid()
--   AND actor_email IS NULL
--   AND vendor_org_id IN (SELECT public.current_user_org_ids())
--   AND event_type = ANY (public.vendor_emittable_event_types())
--   AND (
--         (  -- BRANCH A: 088, byte for byte
--           partnership_id IS NOT NULL
--           AND EXISTS (SELECT 1 FROM public.partnerships p
--                       WHERE p.id            = milestone_events.partnership_id
--                         AND p.vendor_org_id = milestone_events.vendor_org_id
--                         AND p.lead_org_id   = milestone_events.org_id)
--         )
--         OR
--         (  -- BRANCH B: new
--           partnership_id IS NULL
--           AND (
--                 (  subject_type = 'rfp_inbox'
--                    AND EXISTS (SELECT 1 FROM public.partner_rfp_inbox i
--                                WHERE i.id            = milestone_events.subject_id
--                                  AND i.vendor_org_id = milestone_events.vendor_org_id
--                                  AND i.lead_org_id   = milestone_events.org_id) )
--                 OR
--                 (  subject_type = 'bid'
--                    AND EXISTS (SELECT 1
--                                FROM public.partner_rfp_responses r
--                                JOIN public.partner_rfp_inbox    i ON i.id = r.inbox_item_id
--                                WHERE r.id            = milestone_events.subject_id
--                                  AND i.vendor_org_id = milestone_events.vendor_org_id
--                                  AND i.lead_org_id   = milestone_events.org_id) )
--               )
--         )
--       )
--
-- THE FIVE CLAUSES ABOVE THE PARENTHESIS ARE UNTOUCHED AND STILL APPLY
-- TO BOTH BRANCHES. A branch B row still needs actor_side 'vendor', the
-- caller's own actor_id, a null actor_email, a vendor_org_id the caller
-- is a member of, and an event type on vendor_emittable_event_types().
-- Branch B relaxes exactly one thing: WHICH ROW proves the relationship.
--
-- =====================================================================
-- THE OVERLAP CASE. THE BRANCHES ARE MUTUALLY EXCLUSIVE, NOT MERELY
-- DISJOINT, AND THAT IS DELIBERATE.
-- =====================================================================
--
-- Once a vendor claims their invitation they have BOTH a partnership AND
-- an inbox row for the same RFP. That is the normal steady state, not an
-- edge case: it is every vendor in the pool who was ever sent an RFP.
--
-- WHY IT MATTERS. Under a disjunction, a row is admitted if EITHER branch
-- says yes. So if two branches could both evaluate against the same row
-- and DISAGREE about which org_id is legitimate, THE WEAKER ONE ADMITS
-- THE ROW and the stronger one is decorative. A disjunction is only as
-- strong as its weakest arm.
--
-- >>> SO THE BRANCHES ARE SPLIT ON `partnership_id IS NULL` VERSUS
-- >>> `IS NOT NULL`, WHICH MAKES THEM MUTUALLY EXCLUSIVE BY
-- >>> CONSTRUCTION. <<<
--
-- Exactly one arm can be true for any row. There is no row for which
-- both are evaluable, therefore no row about which they can disagree,
-- therefore no weaker-arm admission. The question "what if they
-- disagree" is not answered by argument here - it is removed.
--
-- The cheaper spelling was available and is refused: branch B could have
-- been written without `partnership_id IS NULL`, leaving the two merely
-- disjoint in practice. It would even behave identically TODAY, because
-- both arms pin org_id to an organization the caller has a real
-- relationship with. It is refused because "they happen to agree" is a
-- property of the current two arms, and the next arm somebody adds
-- inherits the structure, not the coincidence.
--
-- WHAT HAPPENS TO AN OVERLAP-CASE ROW, CONCRETELY. The emitter resolves
-- a partnership_id (all four read the inbox row's partnership_id first,
-- then fall back to a lead/vendor pair lookup), so the row is written
-- with a non-null partnership_id and is admitted by BRANCH A ALONE.
-- Branch B is not consulted. It is ONE row, inserted once - a WITH CHECK
-- is a boolean test on a row, not a row multiplier, so there is no sense
-- in which a row satisfying "both" is written twice. Assertion T7 in
-- 100_preapply_test.sql writes exactly this case and counts the rows.
--
-- =====================================================================
-- THIS WIDENS AN INSERT GRANT. IT WIDENS NO READ. SAID PLAINLY.
-- =====================================================================
--
-- The standing rule is never to widen an access predicate. THIS FILE
-- WIDENS ONE, DELIBERATELY AND BY RULING, AND PRETENDING OTHERWISE WOULD
-- BE THE DANGEROUS THING TO WRITE HERE. What is true, precisely:
--
--   * IT IS AN INSERT GRANT, NOT A READ GRANT. No SELECT policy on
--     milestone_events or on any other table is touched by this file.
--   * NO COUNTERPARTY CAN READ A BRANCH B ROW. 080's counterparty SELECT
--     policy opens with `partnership_id IS NOT NULL` (080:355). A branch
--     B row has a NULL one by definition, so gate 2 fails on its first
--     clause. These rows are readable by the AGENCY and by nobody else.
--     That asymmetry is what ruling 6 Option A predicted, and it is part
--     of the ruling rather than a side effect of it.
--   * THE WIDENING IS BOUNDED BY THE SAME CLASS OF PROOF BRANCH A USES.
--     Before: a vendor may write onto the feed of an agency they have a
--     partnerships row with. After: OR of an agency that has addressed a
--     partner_rfp_inbox row to them. Both are records the AGENCY created.
--     A vendor cannot manufacture either one.
--   * ON THE ONE AXIS WHERE THE ARMS DIFFER, THE NEW ARM IS NARROWER.
--     Branch A's EXISTS validates partnership_id and says NOTHING about
--     subject_id: a pooled vendor can already write any vendor-emittable
--     type naming any subject_id onto that agency's feed. Branch B starts
--     FROM subject_id and proves that artifact is addressed to the
--     caller, so it refuses what branch A would admit. That asymmetry is
--     not tidied away here: branch A is left EXACTLY as 088 shipped it,
--     because changing it is a change to a live, working, reviewed
--     policy and belongs in its own migration with its own test.
--     >>> SO "a vendor may name another vendor's bid" REMAINS TRUE FOR
--     >>> POOLED VENDORS, ON A PATH THIS FILE DID NOT CREATE AND DOES
--     >>> NOT WIDEN. It is recorded here because this is the file that
--     >>> made it visible, and assertion T4 of the pre-apply test
--     >>> measures only the new arm.
--
-- =====================================================================
-- ORDERING AGAINST THE CODE: THERE IS NO CODE.
-- =====================================================================
--
-- >>> THIS MIGRATION SHIPS ALONE. NO APPLICATION FILE CHANGES. <<<
--
-- All four affected emitters ALREADY pass exactly what branch B needs,
-- and they have since their emitters were written:
--
--   partnership_id  already resolved to NULL when no partnership exists
--   vendor_org_id   already resolveCallerWriteOrgId(), the caller's own
--   org_id          already orgIdFromColumn(inbox.lead_org_id)
--   actor_id        already user.id, actorEmail already absent
--
-- So the ordering constraint that bit 085 - where the decline branch
-- resolved a notification recipient AFTER setting a status, so applying
-- the migration first would have silently killed the decline email -
-- does not arise. There is no second half to be out of step with.
--
-- SAFE TO APPLY AT ANY TIME, IN EITHER ORDER, because there is no order.
-- Before the branch merges, after it merges, or on main today: the
-- effect is identical. The window between deploy and apply, which is the
-- usual thing to reason about, has zero width here.
--
-- AND THE FAILURE MODE IF IT IS NEVER APPLIED IS THE STATUS QUO. The
-- emitters keep resolving null partnership ids, keep being refused with
-- 42501, and keep reporting the drop to Sentry with
-- vendorPartnershipMissing true. Nothing regresses. This file only ever
-- adds rows that are not being written today.
--
-- =====================================================================
-- PRE-FLIGHT CAPTURE. FIVE QUERIES. RUN ALL FIVE BEFORE ANYTHING ELSE.
-- =====================================================================
--
-- P1. >>> IS 088 APPLIED AT ALL? THIS CAN STOP THE MIGRATION. <<<
--     Expect exactly ONE row, named "Vendors insert own company
--     milestone events", cmd = INSERT.
--
--     ZERO ROWS MEANS 088 WAS NEVER APPLIED, and this file's DROP POLICY
--     IF EXISTS would then create a policy where none existed - which is
--     not a repair, it is 088 and 100 arriving together under one
--     number. STOP. Apply 088 first, confirm it, then return here.
--     LIGAMENT_CONTEXT.md does not record 088 as applied; its migration
--     log stops at 078 and names only 079, 080, 082 and 087. So this is
--     a live question and not a formality.
--
--       SELECT policyname, cmd, roles, with_check
--       FROM pg_policies
--       WHERE schemaname = 'public'
--         AND tablename  = 'milestone_events'
--         AND cmd        = 'INSERT'
--       ORDER BY policyname;
--
-- P2. >>> DOES THE LIVE POLICY MATCH WHAT THIS FILE THINKS IT REPLACES?
--     <<< Read the with_check from P1 by eye against THE FULL PREDICATE
--     printed above. If it differs anywhere - an extra clause, a missing
--     one, a different spelling of the membership test - then somebody
--     changed it outside this repository, and the branch A text below is
--     not a faithful copy of what is live. STOP and reconcile. Replacing
--     an unknown policy with a remembered one is how a hardening gets
--     silently reverted.
--
-- P3. The vendor-emittable whitelist, which branch B does not change.
--     Expect 7 rows: bid.submit, bid.revise, rfp.view, invitation.accept,
--     invitation.decline, nda.acknowledge, status_update.post.
--
--       SELECT unnest(public.vendor_emittable_event_types()) AS t ORDER BY 1;
--
-- P4. HOW MUCH THIS WILL ACTUALLY UNBLOCK. Inbox rows whose vendor has a
--     claimed organization but NO partnership with that lead agency -
--     the exact population branch B admits. There is no expected value;
--     it is whatever it is, and it is the number to compare the feed
--     against afterwards. Zero would mean the repair is correct and
--     currently unexercised, which is worth knowing BEFORE reading a
--     feed that did not change.
--
--       SELECT count(*) AS unblocked_inbox_rows
--       FROM public.partner_rfp_inbox i
--       WHERE i.vendor_org_id IS NOT NULL
--         AND NOT EXISTS (
--           SELECT 1 FROM public.partnerships p
--           WHERE p.vendor_org_id = i.vendor_org_id
--             AND p.lead_org_id   = i.lead_org_id
--         );
--
--     AND THE SAME COUNT FOR THE BID SUB-ARM, which hops through
--     partner_rfp_responses. A response whose inbox_item_id is NULL is a
--     GUEST bid: the guest route is service-role, RLS never applied to
--     it, and branch B is irrelevant to those rows. If this count is
--     non-zero while the one above is zero, the bid sub-arm is the half
--     doing the work.
--
--       SELECT count(*) AS unblocked_bid_rows
--       FROM public.partner_rfp_responses r
--       JOIN public.partner_rfp_inbox    i ON i.id = r.inbox_item_id
--       WHERE i.vendor_org_id IS NOT NULL
--         AND NOT EXISTS (
--           SELECT 1 FROM public.partnerships p
--           WHERE p.vendor_org_id = i.vendor_org_id
--             AND p.lead_org_id   = i.lead_org_id
--         );
--
-- P5. Total policy count across the schema, for the delta check at the
--     foot. This file DROPs one policy and CREATEs one, so the count
--     must be UNCHANGED. A change means something else ran.
--
--       SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--
-- =====================================================================


BEGIN;


-- ---------------------------------------------------------------------
-- 1. NO NEW INDEX, AND THAT IS WORTH ONE PARAGRAPH RATHER THAN SILENCE.
--
-- An earlier draft of this file created a composite index on
-- partner_rfp_inbox (vendor_org_id, lead_org_id), because its branch B
-- proved the RELATIONSHIP by looking for any inbox row between the two
-- organizations. Branch B as it now stands proves the ARTIFACT instead:
-- every lookup below starts from a PRIMARY KEY - partner_rfp_inbox.id, or
-- partner_rfp_responses.id joined to partner_rfp_inbox.id - so the
-- indexes that serve it already exist and cannot be dropped.
--
-- The stronger predicate therefore costs less to execute than the weaker
-- one did. That is not a coincidence: a pin that starts from an id the
-- caller supplied is a point lookup, and a pin that searches for any
-- matching row is a scan.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 2. The policy, replaced in place.
--
-- DROP then CREATE rather than ALTER: Postgres has no syntax for editing
-- a WITH CHECK in place, and a second policy would be a DISJUNCTION with
-- the first (permissive policies OR together), which would leave 088's
-- version live and unremovable-by-this-file. That is the opposite of a
-- replacement.
--
-- IF EXISTS on the DROP: see P1. It is a guard against a torn state, not
-- a licence to run this without 088.
--
-- >>> BRANCH A BELOW IS 088's CLAUSE, TOKEN FOR TOKEN. Only the
-- >>> INDENTATION differs, because it is now nested inside a
-- >>> parenthesis. Verified by normalizing whitespace on both and
-- >>> comparing the strings, not by reading them:
-- >>>
-- >>>   sed -n '452,459p' supabase/migrations/088_vendor_milestone_events.sql \
-- >>>     | tr -s '[:space:]' ' '
-- >>>   sed -n '427,434p' supabase/migrations/100_milestone_inbox_pin.sql \
-- >>>     | tr -s '[:space:]' ' '
-- >>>
-- >>> The 088 line begins with the AND that joins it to the clause
-- >>> above; in this file that AND is the `AND (` opening the
-- >>> disjunction. Everything after it is identical.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Vendors insert own company milestone events" ON public.milestone_events;

CREATE POLICY "Vendors insert own company milestone events"
  ON public.milestone_events AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_side = 'vendor'
    -- The vendor writes their own name. NOT `(actor_id IS NULL OR ...)`:
    -- a null actor is the guest shape and the guest path does not come
    -- through here. 088's reasoning, unchanged.
    AND actor_id = auth.uid()
    -- lib/milestone-events.ts' actor_email rule, made structural.
    AND actor_email IS NULL
    -- The acting company. NOT org_id - on a vendor row that names the agency.
    AND vendor_org_id IN (SELECT public.current_user_org_ids())
    -- A vendor may author only vendor acts. text[], so = ANY is correct here.
    AND event_type = ANY (public.vendor_emittable_event_types())
    AND (
      -- ---------------------------------------------------------------
      -- BRANCH A. 088, UNCHANGED. The partnership-pinned path.
      -- Still the path every pooled vendor takes, and still the only
      -- path whose rows a counterparty can ever read.
      -- ---------------------------------------------------------------
      (
        partnership_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.partnerships p
          WHERE p.id            = milestone_events.partnership_id
            AND p.vendor_org_id = milestone_events.vendor_org_id
            AND p.lead_org_id   = milestone_events.org_id
        )
      )
      OR
      -- ---------------------------------------------------------------
      -- BRANCH B. NEW. The inbox-pinned path. RULING 6.
      --
      -- `partnership_id IS NULL` is not a formality: it is what makes
      -- this arm MUTUALLY EXCLUSIVE with branch A rather than merely
      -- disjoint, so the two can never both evaluate against one row and
      -- disagree. See THE OVERLAP CASE in the header.
      --
      -- IT PINS org_id, which is branch A's second and most important
      -- job. Without a pin nothing in this policy constrains org_id, and
      -- org_id is the column the agency's SELECT policy reads.
      --
      -- >>> AND IT PINS subject_id TOO, WHICH BRANCH A DOES NOT. <<<
      -- Branch A's EXISTS validates partnership_id and says nothing
      -- about which row the event claims to be about. Branch B starts
      -- FROM subject_id and proves that particular artifact is addressed
      -- to the caller. So on the one axis where the two arms differ,
      -- THE NEW ARM IS THE NARROWER ONE. A vendor cannot name another
      -- vendor's inbox row or another vendor's bid through this branch,
      -- which is assertion T4 of 100_preapply_test.sql.
      --
      -- TWO SUB-ARMS, BECAUSE THE FOUR AFFECTED EMITTERS CARRY TWO
      -- SUBJECT SHAPES, AND NEITHER MAY BE CHANGED TO SUIT THIS POLICY:
      --
      --   rfp.view, nda.acknowledge -> subject_type 'rfp_inbox',
      --       subject_id = the partner_rfp_inbox row. Direct.
      --
      --   bid.submit, bid.revise    -> subject_type 'bid',
      --       subject_id = the partner_rfp_responses row, NOT the inbox
      --       row. That is REQUIRED of them: lib/activity-feed.ts puts
      --       bid.submit on UNION_REPLACING_EVENT_TYPES keyed on the
      --       response id, and its header states the hard requirement -
      --       "a bid.submit that sets subject_id to the inbox id instead
      --       of the response id makes the two undedupeable". Changing
      --       the emitter to suit this policy would ship a duplicate feed
      --       line. So the policy does the hop instead, through
      --       partner_rfp_responses.inbox_item_id.
      --
      -- THE SECOND SUB-ARM IS NOT A NEW SHAPE OF PROOF. It is the same
      -- join "Partners insert RFP responses for their inbox" already
      -- performs live on partner_rfp_responses (079:1390-1400):
      -- response -> inbox on inbox_item_id, then the inbox row's
      -- lead_org_id and vendor_org_id. This policy asserts what that one
      -- already asserted when the response row was created.
      --
      -- The join conditions are SPELLED OUT rather than leaning on
      -- partner_rfp_inbox's own RLS. "Partners select inbox rows by
      -- partner_id" (079:1352) would already filter these subqueries to
      -- the caller's own rows, because a subquery inside a policy
      -- expression runs as the invoking user. That is true today and this
      -- policy does not rely on it. A predicate whose correctness depends
      -- on another table's policy set widens silently the day somebody
      -- adds a broader SELECT policy there. 088 made this argument for
      -- its own EXISTS and it is the same argument.
      --
      -- NO STATUS PREDICATE ON THE INBOX ROW, matching 080's counterparty
      -- policy and 085's current_user_counterparty_org_ids(), both of
      -- which are status-free on purpose. A vendor whose RFP was later
      -- closed does not stop having opened it.
      -- ---------------------------------------------------------------
      (
        partnership_id IS NULL
        AND (
          (
            subject_type = 'rfp_inbox'
            AND EXISTS (
              SELECT 1
              FROM public.partner_rfp_inbox i
              WHERE i.id            = milestone_events.subject_id
                AND i.vendor_org_id = milestone_events.vendor_org_id
                AND i.lead_org_id   = milestone_events.org_id
            )
          )
          OR
          (
            subject_type = 'bid'
            AND EXISTS (
              SELECT 1
              FROM public.partner_rfp_responses r
              JOIN public.partner_rfp_inbox    i ON i.id = r.inbox_item_id
              WHERE r.id            = milestone_events.subject_id
                AND i.vendor_org_id = milestone_events.vendor_org_id
                AND i.lead_org_id   = milestone_events.org_id
            )
          )
        )
      )
    )
  );


COMMIT;


-- =====================================================================
-- VERIFICATION. RUN AFTER APPLYING. V4 AND V5 ARE THE ONLY TWO THAT
-- PROVE THE POLICY RATHER THAN DESCRIBE IT, AND BOTH ARE WRITES.
--
-- >>> THE FULL PROOF IS supabase/migrations/100_preapply_test.sql, WHICH
-- >>> RUNS BEFORE THIS FILE AND ROLLS BACK. These five are the
-- >>> after-the-fact confirmation, not a substitute for it.
-- =====================================================================
--
-- V1. Exactly one INSERT policy for vendors, and its with_check contains
--     BOTH branches. Expect 1 row, and expect to find the substrings
--     'partnership_id IS NOT NULL' and 'partnership_id IS NULL' in it.
--
--       SELECT policyname, cmd,
--              with_check LIKE '%partnership_id IS NOT NULL%' AS has_branch_a,
--              with_check LIKE '%partner_rfp_inbox%'          AS has_branch_b
--       FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'milestone_events'
--         AND policyname = 'Vendors insert own company milestone events';
--
-- V2. The agency INSERT policy and BOTH SELECT policies are untouched.
--     Expect 4 rows total on this table: 2 SELECT, 2 INSERT, and NO
--     UPDATE and NO DELETE policy for anybody. 080's append-only rule.
--
--       SELECT policyname, cmd FROM pg_policies
--       WHERE schemaname = 'public' AND tablename = 'milestone_events'
--       ORDER BY cmd, policyname;
--
-- V3. Schema-wide policy count UNCHANGED from P5. One dropped, one
--     created. A delta of anything but 0 means something else ran.
--
--       SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--
-- V4. NO INDEX WAS CREATED. Expect ZERO rows. An earlier draft of this
--     file created partner_rfp_inbox_vendor_lead_idx; the final branch B
--     starts from primary keys and does not need it. A row here means an
--     earlier draft was applied to this database and the policy live on
--     it is NOT the one in this file - stop and read the with_check from
--     V1 before doing anything else.
--
--       SELECT indexname FROM pg_indexes
--       WHERE schemaname = 'public' AND tablename = 'partner_rfp_inbox'
--         AND indexname = 'partner_rfp_inbox_vendor_lead_idx';
--
-- V5. THE LIVE PROOF, AND IT IS NOT A QUERY. Sign in to the partner
--     portal as a vendor who has an inbox row and NO partnership with
--     that agency (P4 says whether one exists), open the RFP, and
--     confirm a `rfp.view` row appears:
--
--       SELECT event_type, org_id, vendor_org_id, partnership_id,
--              subject_type, created_at
--       FROM public.milestone_events
--       WHERE actor_side = 'vendor' AND partnership_id IS NULL
--       ORDER BY created_at DESC LIMIT 20;
--
--     ZERO ROWS AFTER THAT ACT MEANS THE REPAIR DID NOT LAND. Before
--     rolling back, check Sentry for drop_reason "insert-failed" with
--     vendorPartnershipMissing true - if it is still firing, the policy
--     is refusing the row and 100_preapply_test.sql will say which
--     clause. Roll back with 100_milestone_inbox_pin_down.sql.
--
-- =====================================================================
-- WHAT THIS FILE DOES NOT DO
-- =====================================================================
--
-- IT DOES NOT MAKE ANY NEW TYPE VENDOR-VISIBLE.
-- vendor_visible_event_types() is not referenced by this file and is not
-- changed by it. The four affected types were already on it; what was
-- missing was the row, not the permission to read it. And a branch B row
-- still cannot be read by any counterparty, because gate 2 opens with
-- `partnership_id IS NOT NULL`.
--
-- IT DOES NOT CONSTRAIN subject_id, on either branch. See the header.
--
-- IT DOES NOT TOUCH THE GUEST PATH. A magic-link guest is not
-- `authenticated`, auth.uid() is NULL for them, and a policy TO
-- authenticated can never apply. The guest route is service-role and
-- constrained by its token check, which is stronger than RLS can
-- express. That remains true and must not be "tidied up" into this
-- policy later.
-- =====================================================================
