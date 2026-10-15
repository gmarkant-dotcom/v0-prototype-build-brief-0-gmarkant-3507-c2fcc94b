-- Data fix 2026-10-15: Lightning inbox rows show their released budget (C7 / step C finding F1).
-- Before step C, Lightning inbox rows carried the budget only in master_rfp_json.totalBudget, which
-- migration 120 removes. Six linked rows have an empty estimated_budget while their record line releases
-- a budget (five backfilled under D2 released = estimated, plus the smoke test record 21f9d17d).
-- This copies the line's released_budget into estimated_budget for exactly those six rows.
-- Fail closed: raises unless exactly 6 rows change. Safe before or after 120. No temp tables.
-- DRY RUN: change the COMMIT line at the end to ROLLBACK, run, then run again with COMMIT.
BEGIN;
DO $fix$
DECLARE v_n int;
BEGIN
  UPDATE public.partner_rfp_inbox i
     SET estimated_budget = l.released_budget
    FROM public.rfp_record_lines l
   WHERE l.id = i.rfp_line_id
     AND i.id IN ('78273faf-5320-4323-84ab-01f96e2140b7','d163b602-dd49-4f55-8b3c-283a209c8156',
                  '76d7cf42-896b-431f-bb3c-51620ab64277','e49417d3-9387-450f-aa49-d8f04aa8b793',
                  '9ff1a364-eeab-40c4-8380-4c065900b003','26a383d8-f01c-4055-9c54-9159deec405e')
     AND nullif(btrim(i.estimated_budget), '') IS NULL
     AND nullif(btrim(l.released_budget), '') IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 6 THEN RAISE EXCEPTION 'C7 fill: % rows matched, expected 6 - nothing written', v_n; END IF;
  RAISE NOTICE 'C7 fill: 6 Lightning inbox rows now carry their released budget';
END
$fix$;
COMMIT;
