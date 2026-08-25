# The six emitter rulings Greg owes

Six blocked items, restated as six answerable questions. Source:
`docs/emitter-coverage.md` §4 and §5 (2026-08-23). Nothing here is implemented and
nothing here should be until the sentence above it has an answer.

Each line gives the question, then what each answer would make the feed say. **The
second half is the point** — a ruling with no visible consequence is not worth a
sentence, and every one of these changes what a real person reads on a real screen.

---

1. **`vendor.remove`** — Should removing a vendor leave a breadcrumb the removed
   vendor's own organization may later read, or is a removal agency-internal?
   *Yes* puts "Removed <vendor> from the vendor pool" on both feeds and the vendor
   watches themselves be dropped; *no* leaves the agency's own feed silent about
   an act that changes who can bid.

2. **`vendor.blacklist`** — Same question, different act: is blacklisting a
   judgment about a company that the company may see?
   *Yes* shows the blacklisted vendor a line naming their own exclusion, which is
   a harder thing to read than a removal; *no* means the agency's feed carries no
   record of a decision that permanently changes that relationship.

3. **`client.edit`** — Does every edit to a client record deserve a feed line, or
   only edits that change something a vendor would notice?
   *Every edit* turns the feed into a change log where "Updated <client>" appears
   after each keystroke-level save; *material only* needs a definition of material,
   and until there is one the feed says nothing when a client's standing
   requirements change underneath an open RFP.

4. **`rfp.generate` / `rfp.regenerate`** — Is an AI generation a milestone, or is
   only the broadcast that follows it one?
   *Generation counts* puts five lines on the feed for one RFP that was regenerated
   four times before sending; *broadcast only* means the feed shows the day's work
   as a single "Broadcast <RFP> to N vendors" and the drafting is invisible.

5. **`bid.analyze` / `bid.analyze_retry`** — Is the analysis the milestone, or is
   only the human decision that follows it?
   *Analysis counts* records that the agency looked, including every retry after a
   failed run, and a vendor reading the counterparty feed learns their bid was
   analyzed three times; *decision only* means the feed jumps from bid received to
   shortlisted with nothing in between.

6. **The vendor with no partnership** (`docs/emitter-coverage.md` §5) — Should a
   vendor who has never been added to the pool be able to write a breadcrumb onto
   the agency's feed at all, and if so what pins `org_id` in place of the
   partnership row that 088's policy requires?
   *No* is the status quo and means `rfp.view` and `nda.acknowledge` silently write
   nothing for every magic-link vendor, so the agency's feed shows an RFP sent and
   never shows it opened; *yes* needs a migration that pins `org_id` some other way,
   because dropping the null check alone reopens the feed-injection hole 088 exists
   to close.

---

**Not in this list, and deliberately: the other twelve unrendered types.** They
need a wording, not a ruling. That is a smaller decision but it is still a
decision, and `mapMilestoneGroup()` drops a type with no renderer from the feed
entirely (`lib/activity-feed.ts:435`), so twelve wordings written unattended would
be twelve lines of product voice nobody chose.
