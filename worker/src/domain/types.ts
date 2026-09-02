/**
 * Canonical DG record. A single UN number may resolve to more than one
 * DgEntry (e.g. distinct packing configurations) — variantKey is an opaque
 * discriminator between them, not a proper shipping name.
 */
export interface DgEntry {
  readonly unNumber: string;
  readonly variantKey: string;

  readonly primaryClass: string;
  readonly subsidiaryRisks: readonly string[];

  readonly segregationGroups: readonly string[];
  readonly segregationCodes: readonly string[];

  readonly compatibilityGroup: string | null;
}
