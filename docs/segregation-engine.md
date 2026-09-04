# Segregation engine

What the engine evaluates, what it deliberately refuses to decide, and how a
schema v2 dataset is activated. No proprietary source text appears here.

## Dataset schema v2

The canonical private dataset contract is `schemaVersion: 2`:

```
{
  schemaVersion: 2,
  datasetVersion,
  dgEntries,
  classRules,   // + sourceToken
  sgRules       // new
}
```

Validation in `worker/scripts/dataset-import.mjs` stays strict — unknown
fields are still rejected, and every new field has a mandatory, checked shape.

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
already permitted 0, so it is untouched. No SGG, SW, HANDLING or PSN table is
created — segregation-group membership already lives on `dg_entries`.

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

Unknown data never becomes CLEAR by omission.

## API

`POST /segregation/check` keeps its existing request
(`{ leftUnNumber, rightUnNumber }`) and its existing top-level response fields
`ok`, `input`, `decision`, `variants`. Two fields are added:

```
additionalRequirements: AdditionalRequirement[]
variantResolution: "UNIFORM" | "STRICTEST_OF_MULTIPLE_VARIANTS"
```

Nothing is renamed or removed, so an older client that ignores the new fields
still parses ordinary responses. Batch input is not implemented.

## Production activation

**Not deployed.** This engine must not be activated in production until the
mobile client can surface `additionalRequirements`, because a client that
ignores that field would show a level-0 result as unrestricted while an
obligation is outstanding.

Readiness recognizes two schema versions so migration, import and deployment
can be staged without an unavailable window:

- **v1** has no `sg_rules` content. It stays serviceable under the new Worker
  and stays fail-closed: with no SG rules loaded, any entry carrying an SG code
  resolves to `UNKNOWN_SG_CODE` and therefore `REVIEW_REQUIRED`. It cannot
  answer CLEAR for a pair whose provisions have not been imported.
- **v2** additionally requires `sg_rules` to be populated. An empty `sg_rules`
  table is never accepted as a valid v2 dataset, so a half-finished import
  reports not-ready instead of serving an engine with no special provisions.

Safe activation order, once the client is ready:

1. apply migration `0004` to the remote D1 database — additive only; the
   deployed v1 dataset keeps serving throughout
2. deploy the Worker — still reading the v1 dataset, fail-closed on SG codes
3. import the schema v2 dataset — readiness flips to v2 only after the final
   `dataset_version` write, once every row is in place
4. release the mobile client that renders `additionalRequirements`

Steps 1–3 are each independently safe to stop at.
