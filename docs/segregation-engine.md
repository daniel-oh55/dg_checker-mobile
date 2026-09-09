# Segregation engine

What the engine evaluates, what it deliberately refuses to decide, and how a
schema v3 dataset is activated. No proprietary source text appears here.

## Dataset schema v3

The canonical private dataset contract is `schemaVersion: 3`:

```
{
  schemaVersion: 3,
  datasetVersion,
  dgEntries,    // + properShippingName
  classRules,   // + sourceToken (v2)
  sgRules       // v2
}
```

Validation in `worker/scripts/dataset-import.mjs` stays strict — unknown
fields are still rejected, and every new field has a mandatory, checked shape.

**`dgEntries`** gains `properShippingName`, read from the authorized
`Proper shipping name (PSN)` column of the same DGL source row that produced
the entry's UN number, class, subsidiary hazards and segregation field, so the
name can never drift out of alignment with the regulatory columns. The
converter normalizes it only as far as a stable single-line API value
requires — the ExcelJS rich-text/hyperlink wrapper is unwrapped and runs of
whitespace (newlines and NBSP included) collapse to single spaces. Wording is
otherwise untouched: nothing is translated, re-cased, expanded, re-punctuated
or dropped, and `N.O.S.` and every other qualifier survives verbatim. A
logical entry with no usable name fails the whole conversion rather than
importing a placeholder.

Some logical DGL entries are wrapped across several sheet rows by merging the
UN cell. Those **continuation rows are part of the entry above them**, so
their name fragments are appended in source row order and normalized into the
one string — see
[Converter fail-closed invariant](#converter-fail-closed-invariant). Reading
only the master row would have silently truncated those names at the wrap
point.

`properShippingName` is **display/reference data only**. The segregation
engine never reads it, and no decision may depend on it — see
[Proper shipping name is informational](#proper-shipping-name-is-informational).
It is mandatory and non-empty in the canonical snapshot, while the D1 column
is nullable so pre-v3 rows stay serviceable during rollout.

**`classRules`** gains `sourceToken`, recording which authorized matrix cell
token produced the row (`"X"`, or `"1"`–`"4"`). The token must agree with the
level it was converted to, which is what makes "X became level 0" auditable
rather than indistinguishable from a numeric 0 the source never contained.

**`sgRules`** is one row per authorized special-segregation-provision code,
with a `ruleType` from a small fixed set:

| ruleType | Meaning | level |
| --- | --- | --- |
| `DIRECT_CLASS` | numeric level against the other cargo's hazard class(es) | 1–4 |
| `DIRECT_SGG` | numeric level against the other cargo's segregation group | 1–4 |
| `DIRECT_UN` | numeric level against a specific UN number | 1–4 |
| `AS_FOR_CLASS` | substitute a target class, then use the class matrix | `null` |
| `ADDITIONAL_REQUIREMENT` | a non-level obligation that must be surfaced | `null` |
| `REVIEW_ONLY` | conditions this engine cannot evaluate | `null` |
| `RESERVED` | reserved in the source; must never be applied | `null` |

There is no generic condition JSON and no expression language. Anything that
cannot be represented safely and mechanically becomes `REVIEW_ONLY`.

### Database

Migration `0004_segregation_engine_completion.sql` adds `source_token` to
`segregation_class_rules` and creates `sg_rules`. The existing `level` CHECK
already permitted 0, so it is untouched. No SGG, SW or HANDLING table is
created — segregation-group membership already lives on `dg_entries`.

Migration `0005_dg_proper_shipping_name.sql` adds `proper_shipping_name TEXT`
to `dg_entries`. It is additive: the table is not rebuilt and no index is
added, because the column is only ever projected, never a query predicate.

The column is deliberately **nullable** even though the schema-v3 snapshot
guarantees a name for every entry. That is what lets the migration be applied
while production still serves its older dataset: those rows keep a NULL name
and stay fully serviceable. SQLite cannot add a `NOT NULL` column without a
default, and a default would mean inventing a placeholder name. Completeness
is enforced where it belongs instead — the converter fails on a missing source
PSN, the import harness rejects a blank one, and schema-v3 readiness fails if
any persisted row is NULL or blank.

## Engine coverage

Evaluation order for one concrete DG entry variant pair:

1. normalize source hazard data
2. detect unresolved / unsupported subsidiary data
3. detect the Class 1 limitation
4. base primary ↔ primary matrix lookup
5. permitted subsidiary matrix axes
6. SG rules, holder = left
7. SG rules, holder = right
8. same-primary-class subsidiary exception

Numeric contributions aggregate by `max`, so **a weaker rule can never reduce
a stronger one**. Review blockers dominate any numeric result.

### X semantics

`X` in the authorized matrix means the **base matrix contributes no numeric
segregation level**. It does *not* mean "stop evaluating".

An `X` cell is therefore stored as a real level-0 rule, not omitted, and the
engine still goes on to evaluate subsidiary risks, SG → CLASS, SG → SGG,
SG → UN, AS_FOR_CLASS and additional requirements on top of it. `base X` plus
an SG rule at level 2 yields a final level 2. X never lowers a stronger result.

An absent class pair is a different thing entirely: it fails closed to review.

### Subsidiary risks

With at most one resolved subsidiary hazard per entry, all applicable axes are
evaluated — including **Sub ↔ Sub**, which the reference implementation missed:

```
Primary A ↔ Primary B
Sub A     ↔ Primary B
Primary A ↔ Sub B
Sub A     ↔ Sub B
```

A standalone `P` in the source subsidiary column is an orthogonal
marine-pollutant marker, not a hazard class. It is stripped before class
parsing, so a `"<class> P"` cell keeps its hazard class instead of being
discarded whole; a marker-only cell resolves to no subsidiary risk, since the
marker has no row in the segregation matrix.

### SG and SGG

An SG code is evaluated in both directions, so a provision on either entry
applies. Segregation-group membership on its own imposes **nothing**: `SGG1` on
one entry and nothing relevant on the other is not a segregation requirement.
A level appears only when the other entry actually holds an SG rule targeting
that group.

Class and division targets are matched through explicit source-derived
normalization, never naive string equality — a broad `class 1` target resolves
to the three published Class 1 group rows rather than failing to match any of
them.

### Class 1

Class 1 divisions are normalized to the three rows the authorized matrix
actually publishes (`1.1 1.2 1.5`, `1.3 1.6`, `1.4`), so **Class 1 ↔
non-Class-1 is fully evaluated** from the authorized table.

The compatibility letter is preserved on the entry but never used to decide a
level.

**Class 1 ↔ Class 1 is `REVIEW_REQUIRED`.** The matrix holds `*` there and the
authorized source does not publish the compatibility-group tables needed to
resolve it. There is no fallback level — in particular, no
"unresolved → level 2" behaviour.

### Additional requirements

Six source codes express obligations that are not a 0–4 level. They are
classified `ADDITIONAL_REQUIREMENT` and collected separately:

```
additionalRequirements: [{ code, source: "SG", requiresConfirmation: true }]
```

A pair can therefore have **computed level 0 *and* a non-empty
`additionalRequirements` list**. That combination must never be described as
unrestricted or "safe to mix" — there is an outstanding obligation that has to
reach the operator.

`AdditionalRequirement` is not the same as `REVIEW_REQUIRED`; the two concepts
stay separate. Only the code and its classification are exposed, not the
regulatory prose.

### Multi-variant aggregation

Every left variant × right variant pair is evaluated.

- Any variant pair `REVIEW_REQUIRED` → aggregate `REVIEW_REQUIRED`.
- Otherwise the aggregate takes the **maximum** level across variant pairs.
- `variantResolution` is `UNIFORM` when every pair agreed, and
  `STRICTEST_OF_MULTIPLE_VARIANTS` when they did not. In the latter case the
  reason says the shown result is the strictest applicable one and that the
  specific variant is unresolved — it never claims all variants require it.
- `additionalRequirements` are unioned and deduplicated across variant pairs,
  including pairs that individually resolved to review.

## REVIEW_REQUIRED boundaries

Unresolved regulatory conditions stay fail-closed. A pair is
`REVIEW_REQUIRED` when any of these holds:

| Blocker | Cause |
| --- | --- |
| `CLASS1_TO_CLASS1_UNRESOLVED` | `*` cell; compatibility-group tables absent from source |
| `UNRESOLVED_SUBSIDIARY_SOURCE` | subsidiary cell the converter could not resolve mechanically |
| `MULTIPLE_SUBSIDIARY_RISKS` | two or more resolved subsidiary risks on one entry |
| `SAME_CLASS_SUBSIDIARY_REVIEW` | shared primary class, requirement introduced only by a subsidiary axis |
| `REVIEW_ONLY_SG_CODE:<code>` | SG provision with conditions this engine cannot model |
| `RESERVED_SG_CODE:<code>` | entry unexpectedly references a reserved code |
| `UNKNOWN_SG_CODE:<code>` | SG code with no row in `sg_rules` |
| `MISSING_CLASS_RULE:<a>\|<b>` | required class pair absent from the authorized table |
| `MALFORMED_SG_RULE:<code>` | stored rule shape the runtime refuses to guess about |

Multiple-subsidiary and same-primary-class cases are deliberate fail-closed
policy, not gaps to be papered over: the authorized dataset does not carry the
dangerous-reaction detail needed to finalize them, and this PR does not build a
multiple-subsidiary exception engine.

### Blockers are internal

Those blockers are **diagnostic values, not an API field**. Several embed
content read straight out of the private source — the `<code>` in
`UNKNOWN_SG_CODE`, the class labels in `MISSING_CLASS_RULE`, and an
unresolvable source cell, which reaches the code position verbatim as an
`UNRESOLVED_SOURCE:<raw text>` payload.

So `decision.reason` is **not** assembled from them. Every `REVIEW_REQUIRED`
decision — single endpoint and batch, per-pair and aggregated — carries one
stable generic sentence:

```
Manual review required due to unresolved or unsupported segregation conditions.
```

A per-cause reason would itself be a side channel, telling a caller which
private source condition fired. The blockers stay on
`PairEvaluation.reviewBlockers` for evaluation, logging and debugging, and are
not part of the single or batch response contract.

For the same reason, `dgSummaries[].profiles[].subsidiaryRisks` reports an
unresolvable subsidiary value as `UNSPECIFIED_SUBSIDIARY_HAZARD` rather than
as its `UNRESOLVED_*` token: the hazard's *existence* is why the pair fails
closed and must stay visible, but its source payload is withheld. Withholding
detail never softens a decision — the status and level are unchanged.

## Converter fail-closed invariant

No authorized source row may silently disappear because the converter does not
understand it.

- **SG sheet** — every row becomes an automatic rule, an additional
  requirement, `REVIEW_ONLY`, `RESERVED`, or a hard conversion failure.
  Unrecognized wording stops the conversion. Duplicate codes, malformed codes
  and an unexpected row count all fail.
- **Matrix** — every cell becomes a numeric rule, an `X` → level-0 rule, an
  omitted `*` Class 1 ↔ Class 1 pair, or a hard failure. A `*` outside the
  Class 1 ↔ Class 1 region fails the conversion.
- **Subsidiary column** — every non-empty value becomes resolved hazard
  classes or an explicit `UNRESOLVED_*` token, which the engine routes to
  review rather than dropping.
- **UN No. column** — every non-blank row becomes a DG entry or a hard
  failure. A malformed non-empty UN value is never counted and skipped; only a
  row blank in the UN column *and* every other column the converter reads
  (a trailing spacer) is skipped.
- **Merged continuation rows** — the source wraps some logical DGL entries
  across several sheet rows by merging the UN cell. Such a row is *not* a new
  entry and is *not* discarded: its proper-shipping-name fragment is appended
  to the master entry's name in source row order, under the same whitespace
  normalization, so the final name is one stable single-line string with no
  qualifier wording lost. A fully blank continuation row contributes nothing.
  An **independent** value in a regulatory input column (class or division,
  subsidiary hazard(s), segregation) on a continuation row hard-fails: it
  cannot be attributed to the master entry as presentation continuation, and
  the converter never guesses whether it qualifies that entry or describes a
  second one.

Unknown data never becomes CLEAR by omission.

### SG class targets must exist in the matrix

Every `DIRECT_CLASS` and `AS_FOR_CLASS` target must name a class label present
in the same dataset's validated `classRules`. This is membership, not syntax:
a class-shaped label with no matrix row fails *open* at runtime — it matches
nothing, so the level it was meant to impose silently disappears. The allowed
set is derived from the dataset's own `classRules`, never a hard-coded list,
so it stays correct across source revisions. Note the matrix publishes the
*collapsed* Class 1 rows, so a bare division such as `1.1` is correctly
rejected as a target.

## API

`POST /segregation/check` keeps its existing request
(`{ leftUnNumber, rightUnNumber }`) and its existing top-level response fields
`ok`, `input`, `decision`, `variants`. Two fields are added:

```
additionalRequirements: AdditionalRequirement[]
variantResolution: "UNIFORM" | "STRICTEST_OF_MULTIPLE_VARIANTS"
```

Nothing is renamed or removed, so an older client that ignores the new fields
still parses ordinary responses.

### `POST /segregation/check-batch`

Evaluates every unordered pair among 2–10 UN numbers in one request, using the
exact same engine and aggregation as `/segregation/check` — a pair evaluated
inside a batch produces the identical `decision`, `additionalRequirements`,
`variantResolution` and variant counts as the same pair evaluated directly.
`worker/src/domain/evaluate-un-pair.ts` (`evaluateResolvedUnPair`) is the
shared helper both endpoints call, so there is exactly one implementation of
"evaluate one resolved UN pair" to keep in sync.

```
{ "unNumbers": ["1002", "1088", "1993", "1006"] }
```

- **Count**: 2–10 items, inclusive.
- **Normalization**: each item is normalized with the existing
  `normalizeUnNumber()` (so `"UN1002"`, `"1002"`, and `"4"` → `"0004"` all
  resolve the usual way).
- **Distinctness**: normalized UN numbers must be distinct. Duplicate input
  (including inputs that only collide after normalization, e.g. `"4"` and
  `"0004"`) is rejected with `400 DUPLICATE_UN_NUMBER` and the canonical
  duplicate(s) — it is never silently deduplicated, because a repeated input
  UN number would otherwise produce indistinguishable duplicate pair rows and
  misleading pair counts. The existing `/segregation/check` endpoint is
  unaffected and still allows a UN number checked against itself.
- **Missing DG data**: if any requested UN number has zero entries, the whole
  request fails with `404 DG_NOT_FOUND` and every missing canonical UN number
  in request order; no partial pair evaluation happens.
- **Dataset readiness / DB access**: `getDatasetStatus()` is checked once per
  request (not once per pair), DG entries for every requested UN number are
  loaded with a single `WHERE un_number IN (...)` query
  (`findDgEntriesByUnNumbers`), and the class-rule and SG-rule tables are each
  loaded once and reused across every pair — never once per pair.

**Pair generation**: for `N` distinct inputs, every unordered pair `(i, j)`
with `i < j` in input order is generated exactly once (`N` choose `2`; 10
inputs → 45 pairs). Reverse duplicates (`B↔A` when `A↔B` already exists) and
self-pairs are never generated. Pairs are returned in that same deterministic
input order (`A↔B, A↔C, ..., B↔C, ...`), not sorted by severity — that is left
to the client's presentation layer.

Each pair result carries only the minimum decision contract — `leftUnNumber`,
`rightUnNumber`, `decision`, `variants`, `additionalRequirements`,
`variantResolution` — never `sourceText`, proprietary SG prose, full DGL rows,
`variantKey`, or internal database IDs.

**`dgSummaries`** is an additive field carrying the compact DG identity of
each input UN number — what the batch UI needs to label a result. It is built
from the entries already loaded for the pair evaluation, so it costs no extra
query, and it is returned in the **same order as `input.unNumbers`**, one
entry per input, so a client can index into it directly.

```
dgSummaries: [
  {
    unNumber: "1234",
    variantCount: 2,
    profiles: [
      { primaryClass, subsidiaryRisks, properShippingName },
      ...
    ]
  },
  ...
]
```

A UN number can resolve to several dataset variants, and there is no
authorized basis for picking one of them as *the* answer — so no variant is
ever chosen as representative. Instead:

- **`variantCount`** is the real number of `DgEntry` rows behind the UN
  number, so genuine dataset ambiguity is always visible.
- **`profiles`** holds the *distinct* visible profiles. Variants that differ
  only in fields the API does not expose collapse into one profile, because a
  client could not tell them apart anyway. So `variantCount: 3` with
  `profiles.length: 2` is normal and meaningful: three source variants, two
  materially different descriptions.
- **Ordering** is deterministic, derived from the public fields only
  (`primaryClass`, then `subsidiaryRisks` joined, then `properShippingName`),
  never from SQLite row order. No severity ordering is implied.
- **`properShippingName` may be `null`** while the service still runs against
  a pre-v3 dataset. The API never substitutes `"Unknown"`, `"N/A"` or any
  other placeholder — how to present a missing name is the client's decision.

A profile carries those three fields and nothing else. `variantKey`,
`segregationCodes`, `segregationGroups`, `compatibilityGroup`, SG
`sourceText`, workbook row numbers and database IDs all stay internal.

`POST /segregation/check` is deliberately left unchanged: the 2–10 input UI
uses the batch endpoint even when N = 2, so there is no reason to widen the
single-pair contract.

**Summary** is counts only, never a single collapsed batch-wide level:

```
summary: {
  inputCount, totalPairs,
  segregationRequiredPairs, reviewRequiredPairs, noSegregationLevelPairs,
  additionalRequirementPairs,
  maxRequiredLevel
}
```

`noSegregationLevelPairs` counts `CLEAR` (level 0) decisions and must never be
read as "safe" or "mixable" — a level-0 pair can still carry a non-empty
`additionalRequirements` list (see above), which
`additionalRequirementPairs` tracks independently of `decision.status`.
`maxRequiredLevel` is the maximum level among `SEGREGATION_REQUIRED` pairs
only, and stays `null` — never fabricated as `0` — when no pair is
`SEGREGATION_REQUIRED`.

This PR ships the batch contract and mobile API client/types only; the mobile
UI for entering 2–10 UN numbers is a later PR.

## Proper shipping name is informational

The proper shipping name is reference data for display. It is **never** an
input to a regulatory decision, and specifically takes no part in:

- class-matrix evaluation or subsidiary-risk evaluation
- SG or SGG matching, or `DIRECT_UN` matching (which matches the canonical UN
  number, never name text)
- Class 1 handling, strongest-rule aggregation, or `REVIEW_REQUIRED` logic

Adding it changed no segregation result. Two otherwise-identical fixtures with
different shipping-name text produce the same decision, and so do a pair with
names and the same pair without them — both are asserted in
`worker/test/segregation-check-batch-dg-summaries.test.ts`. Regulatory logic is
never coupled to name text.

## Production activation

**Not deployed.** This engine must not be activated in production until the
mobile client can surface `additionalRequirements`, because a client that
ignores that field would show a level-0 result as unrestricted while an
obligation is outstanding.

Readiness recognizes three schema versions so migration, import and deployment
can be staged without an unavailable window. Older versions stay serviceable
indefinitely:

- **v1** has no `sg_rules` content. It stays serviceable under the new Worker
  and stays fail-closed: with no SG rules loaded, any entry carrying an SG code
  resolves to `UNKNOWN_SG_CODE` and therefore `REVIEW_REQUIRED`. It cannot
  answer CLEAR for a pair whose provisions have not been imported.
- **v2** additionally requires `sg_rules` to be populated. An empty `sg_rules`
  table is never accepted as a valid v2 dataset, so a half-finished import
  reports not-ready instead of serving an engine with no special provisions.
- **v3** is v2 plus a proper shipping name on every DG entry. A NULL or blank
  name is only possible in a v3 dataset if the import was incomplete or the
  metadata was mislabelled, so it fails readiness rather than serving
  summaries with silently missing names. "Blank" means blank in every
  whitespace form the source and runtime produce — space, tab, LF, CR,
  vertical tab, form feed and NBSP — because SQLite's one-argument `TRIM()`
  strips only ordinary spaces, so a name of `"<tab><newline>"` would otherwise
  have passed. The check stays bounded by `LIMIT 1` and never loads the names
  into the Worker. The same NULL is perfectly valid — and stays serviceable —
  under v1/v2, where the column simply predates the dataset.

**Production is still on the older dataset**, and schema v3 is the eventual
activation dataset. Production may jump straight from its current dataset to
v3: activating v2 first is *not* required, and v2 stays recognized only for
compatibility.

Safe activation order:

1. apply the outstanding remote migrations — `0004` and `0005` — to the remote
   D1 database. Both are additive; the deployed older dataset keeps serving
   throughout, its rows simply carrying a NULL `proper_shipping_name`
2. deploy the Worker — still reading the old dataset, fail-closed on SG codes,
   and returning `properShippingName: null` in `dgSummaries`
3. release the mobile client that renders `additionalRequirements` and handles
   `dgSummaries` with a nullable `properShippingName`, staying
   backward-compatible with the old response while rollout is in progress
4. only after that compatible mobile client is available, import the schema
   v3 dataset — readiness flips to v3 only after the final `dataset_version`
   write, once every row is in place

On the ordering inside the generated import: Cloudflare's remote
`d1 execute --file` bulk import rolls the whole operation back on failure and
blocks database requests while it runs, so a failed remote bulk import does
not leave partially committed statements behind. The generated SQL still
deletes the two readiness metadata keys *before* replacing any table, and
rewrites them only at the end. That is defense-in-depth for the paths with no
such guarantee — statements run manually or one at a time, and a
syntactically valid but truncated artifact — and for any future execution path
without the same bulk-import atomicity.

Steps 1 and 2 may safely be completed beforehand, independently of the
client. **Schema-v3 dataset activation/import (step 4) must never precede the
compatible mobile release (step 3):** a v2/v3 dataset can return
`decision.level = 0` together with a non-empty `additionalRequirements` list,
and a client that ignores that field would show such a pair as unrestricted
while an obligation is outstanding. Step 4 is the actual feature/data
activation point — everything before it is infrastructure that stays inert
under the old dataset.

No production operation (migration, deployment, or dataset import) is
performed as part of this PR.
