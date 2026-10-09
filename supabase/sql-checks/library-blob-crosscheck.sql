-- library-blob-crosscheck.sql
--
-- READ-ONLY. One SELECT statement. Not a migration. Run in the Supabase SQL Editor.
-- Question it answers: was the agency_library_documents blob_url hole ever used? Before
-- fix/route-boundary-urgent, library-documents POST/PATCH stored any blob_url from the request
-- body, and /api/agency/library-documents/file streamed it with the app's Blob token.
--
-- Shapes /api/upload writes (the uploader is always the second-to-last path segment):
--   NEW (org prefix):  agency-library/org/{org_id}/{uploader}/{ts}-{name}
--                      reference-materials/org/{org_id}[/{project_id}]/{uploader}/{ts}-{name}
--   LEGACY:            agency-library/{uploader}/{ts}-{name}
--                      reference-materials/{agency_id}[/{project_id}]/{uploader}/{ts}-{name}
--
-- A row is LISTED when any of these holds:
--   wrong_org_prefix     new shape, but the org in the path is not the row's org_id
--   unrecognized_shape   not one of the four shapes above (another folder such as
--                        partner-rfp-bids/ or projects/, a guest upload, a malformed path)
--   uploader_not_member  legacy shape, but the uploader in the path is not a member of the
--                        row's org (another tenant's file, or an uploader who has since left)
--   non_store_host       blob_url host is not {store}.{public|private}.blob.vercel-storage.com
--   blob_path_mismatch   blob_path's folders disagree with blob_url's (the file name is not
--                        compared, because blob_url is percent-encoded and blob_path is not)
--   multi_org            the same blob path appears on rows of more than one organization
-- A legacy row whose uploader IS a member of the owning org, with none of the other flags, is
-- the normal pre-fix shape and is NOT listed. No rows returned means no evidence of use.
--
-- The store id cannot be checked here (it lives in BLOB_READ_WRITE_TOKEN, not the database).
-- `host` is in the output. Every row should show the same store id.

WITH docs AS (
  SELECT
    d.id,
    d.org_id,
    d.created_at,
    d.source_type,
    d.label,
    d.blob_url,
    d.blob_path,
    lower(substring(d.blob_url FROM '^[a-zA-Z]+://([^/?#]+)')) AS host,
    substring(d.blob_url FROM '^[a-zA-Z]+://[^/?#]+/([^?#]*)')   AS url_path
  FROM public.agency_library_documents d
  WHERE d.blob_url IS NOT NULL OR d.blob_path IS NOT NULL
),
seg AS (
  SELECT
    docs.*,
    string_to_array(coalesce(url_path, ''), '/') AS s,
    cardinality(string_to_array(coalesce(url_path, ''), '/')) AS n
  FROM docs
),
classified AS (
  SELECT
    seg.*,
    s[1] AS folder,
    (s[1] IN ('agency-library', 'reference-materials') AND s[2] = 'org') AS is_org_shape,
    CASE WHEN n >= 2 THEN s[n - 1] END AS uploader,
    CASE
      WHEN s[1] = 'agency-library' AND s[2] = 'org' THEN n = 5
      WHEN s[1] = 'reference-materials' AND s[2] = 'org' THEN n IN (5, 6)
      WHEN s[1] = 'agency-library' THEN n = 3
      WHEN s[1] = 'reference-materials' THEN n IN (4, 5)
      ELSE false
    END AS shape_ok
  FROM seg
),
multi AS (
  SELECT url_path
  FROM docs
  WHERE url_path IS NOT NULL AND url_path <> ''
  GROUP BY url_path
  HAVING count(DISTINCT org_id) > 1
),
flagged AS (
  SELECT
    c.*,
    (c.is_org_shape AND c.shape_ok AND c.s[3] IS DISTINCT FROM c.org_id::text) AS wrong_org_prefix,
    (c.blob_url IS NULL OR NOT c.shape_ok)                                    AS unrecognized_shape,
    (NOT c.is_org_shape AND c.shape_ok AND NOT EXISTS (
       SELECT 1 FROM public.org_members m
       WHERE m.org_id = c.org_id AND m.user_id::text = c.uploader
     ))                                                                        AS uploader_not_member,
    (c.blob_url IS NOT NULL
       AND (c.host IS NULL OR c.host !~ '^[a-z0-9]+\.(public|private)\.blob\.vercel-storage\.com$')) AS non_store_host,
    (c.blob_path IS NOT NULL AND c.n >= 2
       AND array_to_string(c.s[1:c.n - 1], '/')
           IS DISTINCT FROM regexp_replace(regexp_replace(c.blob_path, '^/+', ''), '/[^/]*$', '')) AS blob_path_mismatch,
    EXISTS (SELECT 1 FROM multi WHERE multi.url_path = c.url_path)            AS multi_org
  FROM classified c
)
SELECT
  f.id,
  f.org_id,
  o.name AS org_name,
  f.created_at,
  f.source_type,
  f.label,
  f.host,
  f.url_path,
  f.blob_path,
  f.uploader,
  concat_ws(', ',
    CASE WHEN f.wrong_org_prefix    THEN 'wrong_org_prefix'    END,
    CASE WHEN f.unrecognized_shape  THEN 'unrecognized_shape'  END,
    CASE WHEN f.uploader_not_member THEN 'uploader_not_member' END,
    CASE WHEN f.non_store_host      THEN 'non_store_host'      END,
    CASE WHEN f.blob_path_mismatch  THEN 'blob_path_mismatch'  END,
    CASE WHEN f.multi_org           THEN 'multi_org'           END
  ) AS findings
FROM flagged f
LEFT JOIN public.organizations o ON o.id = f.org_id
WHERE f.wrong_org_prefix
   OR f.unrecognized_shape
   OR f.uploader_not_member
   OR f.non_store_host
   OR f.blob_path_mismatch
   OR f.multi_org
ORDER BY f.multi_org DESC, f.url_path, f.created_at;
