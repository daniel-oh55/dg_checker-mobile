-- Final segregation engine review: sg_rules gains the EXEMPTION rule type.
--
-- An authorized SG row can *remove* segregation rather than impose it, under
-- a condition this application cannot verify. Such a row was previously
-- classified ADDITIONAL_REQUIREMENT, which presented a relaxation to the
-- operator as an outstanding obligation. EXEMPTION keeps the source row
-- auditable and distinguishable: at runtime the relaxation is declined and
-- the pair is routed to REVIEW_REQUIRED, because the un-relaxed figure is no
-- safer to publish as a final answer than the relaxation would be to apply.
--
-- SQLite cannot widen a CHECK constraint in place, so the table is rebuilt.
-- It holds ~80 rows and is fully repopulated by every dataset import, so the
-- rebuild is cheap and carries no index or foreign key to recreate.

CREATE TABLE sg_rules_new (
  code TEXT PRIMARY KEY,
  rule_type TEXT NOT NULL CHECK (
    rule_type IN (
      'DIRECT_CLASS',
      'DIRECT_SGG',
      'DIRECT_UN',
      'AS_FOR_CLASS',
      'ADDITIONAL_REQUIREMENT',
      'EXEMPTION',
      'REVIEW_ONLY',
      'RESERVED'
    )
  ),
  targets_json TEXT NOT NULL DEFAULT '[]',
  level INTEGER CHECK (level IS NULL OR level BETWEEN 1 AND 4),
  source_text TEXT NOT NULL
);

INSERT INTO sg_rules_new (code, rule_type, targets_json, level, source_text)
  SELECT code, rule_type, targets_json, level, source_text FROM sg_rules;

DROP TABLE sg_rules;

ALTER TABLE sg_rules_new RENAME TO sg_rules;
