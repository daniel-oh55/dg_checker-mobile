-- PR 12: segregation engine completion.
--
-- 1. segregation_class_rules gains source_token, recording which authorized
--    SEG.TABLE cell token produced the row ("X" for a cell that contributes no
--    numeric base level, "1".."4" for a numeric cell). SQLite's ALTER TABLE
--    cannot add a CHECK constraint, so the allowed-token set is enforced by
--    the offline import harness (worker/scripts/dataset-import.mjs) instead.
--    The existing level CHECK already permits 0, so it is left untouched.
--
-- 2. sg_rules holds the authorized SG (special segregation provision) rows.
--    Every source SG code gets exactly one row: mechanically evaluable rules
--    carry a rule_type + targets + level, and everything the converter cannot
--    prove mechanically is preserved as ADDITIONAL_REQUIREMENT, REVIEW_ONLY or
--    RESERVED so it can never silently vanish into a CLEAR result.
--
-- Deliberately NOT created here: SGG, SW, HANDLING and PSN tables. SGG
-- membership already lives on dg_entries.segregation_groups_json, and the
-- other sheets are out of scope for this PR.

ALTER TABLE segregation_class_rules ADD COLUMN source_token TEXT;

CREATE TABLE sg_rules (
  code TEXT PRIMARY KEY,
  rule_type TEXT NOT NULL CHECK (
    rule_type IN (
      'DIRECT_CLASS',
      'DIRECT_SGG',
      'DIRECT_UN',
      'AS_FOR_CLASS',
      'ADDITIONAL_REQUIREMENT',
      'REVIEW_ONLY',
      'RESERVED'
    )
  ),
  targets_json TEXT NOT NULL DEFAULT '[]',
  level INTEGER CHECK (level IS NULL OR level BETWEEN 1 AND 4),
  source_text TEXT NOT NULL
);
