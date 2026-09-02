CREATE TABLE dg_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  un_number TEXT NOT NULL CHECK (un_number GLOB '[0-9][0-9][0-9][0-9]'),
  variant_key TEXT NOT NULL,
  primary_class TEXT NOT NULL,
  subsidiary_risks_json TEXT NOT NULL DEFAULT '[]',
  segregation_groups_json TEXT NOT NULL DEFAULT '[]',
  segregation_codes_json TEXT NOT NULL DEFAULT '[]',
  compatibility_group TEXT,
  UNIQUE (un_number, variant_key)
);

CREATE INDEX idx_dg_entries_un_number ON dg_entries (un_number);
