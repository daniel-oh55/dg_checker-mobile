/**
 * Canonical DG record. A single UN number may resolve to more than one
 * DgEntry (e.g. distinct packing configurations) — variantKey is an opaque
 * discriminator between them, not a proper shipping name.
 */
export interface DgEntry {
  readonly unNumber: string;
  readonly variantKey: string;

  /**
   * The authorized proper shipping name for this variant. Display/reference
   * data only: no segregation rule reads it, and no decision may depend on
   * it.
   *
   * Nullable at runtime purely for staged rollout. Migration 0005 adds the
   * column before the schema-v3 dataset that populates it is imported, so a
   * Worker running against a still-current schema v1/v2 dataset legitimately
   * reads NULL here. A schema-v3 dataset always carries a real name; null is
   * never coerced into a placeholder like "Unknown".
   */
  readonly properShippingName: string | null;

  readonly primaryClass: string;
  readonly subsidiaryRisks: readonly string[];

  readonly segregationGroups: readonly string[];
  readonly segregationCodes: readonly string[];

  readonly compatibilityGroup: string | null;
}
