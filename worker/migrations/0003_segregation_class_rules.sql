CREATE TABLE segregation_class_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_a TEXT NOT NULL,
  class_b TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 4),
  CHECK (class_a <= class_b),
  UNIQUE (class_a, class_b)
);
