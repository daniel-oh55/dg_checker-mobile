import type { DgEntry } from './types';

/**
 * One publicly visible DG profile for a UN number.
 *
 * Deliberately minimal: this is the whole set of DG fields the API exposes.
 * Internal discriminators and regulatory inputs (variantKey, segregation
 * codes and groups, compatibility group, source row identity) stay private —
 * they exist to drive the engine, not to be rendered.
 */
export interface DgSummaryProfile {
  readonly primaryClass: string;
  readonly subsidiaryRisks: readonly string[];
  /** Null only while the service runs against a pre-schema-v3 dataset. */
  readonly properShippingName: string | null;
}

/**
 * Compact, display-oriented DG description of a single UN number.
 *
 * `variantCount` reports how many DgEntry variants the dataset actually holds
 * for the UN number, while `profiles` holds only the distinct visible
 * profiles. The two can differ: variants that differ solely in private fields
 * collapse into one profile, so a caller sees genuine ambiguity (two profiles)
 * without being handed internal keys to distinguish invisible duplicates.
 */
export interface DgSummary {
  readonly unNumber: string;
  readonly variantCount: number;
  readonly profiles: readonly DgSummaryProfile[];
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Orders profiles deterministically by their public fields only, so the
 * response never depends on SQLite row order. A null proper shipping name
 * sorts before any real name rather than being compared as a string.
 */
function compareProfiles(a: DgSummaryProfile, b: DgSummaryProfile): number {
  return (
    compareStrings(a.primaryClass, b.primaryClass) ||
    compareStrings(a.subsidiaryRisks.join(','), b.subsidiaryRisks.join(',')) ||
    compareStrings(a.properShippingName ?? '', b.properShippingName ?? '')
  );
}

/**
 * Builds the public DG summary for one UN number from the DgEntry rows the
 * caller has already loaded — no extra database work.
 *
 * Never picks a single "representative" variant: every distinct visible
 * profile is returned, because for a multi-variant UN number there is no
 * authorized basis for choosing one class/name over another.
 */
export function buildDgSummary(unNumber: string, entries: readonly DgEntry[]): DgSummary {
  const uniqueProfiles = new Map<string, DgSummaryProfile>();

  for (const entry of entries) {
    const subsidiaryRisks = [...entry.subsidiaryRisks];
    const profile: DgSummaryProfile = {
      primaryClass: entry.primaryClass,
      subsidiaryRisks,
      properShippingName: entry.properShippingName,
    };
    // Keyed on the visible fields exactly as serialized, so two variants are
    // deduplicated only when a client could not tell them apart. The null
    // name is keyed distinctly from any string name.
    const key = JSON.stringify([
      profile.primaryClass,
      subsidiaryRisks,
      profile.properShippingName,
    ]);
    if (!uniqueProfiles.has(key)) {
      uniqueProfiles.set(key, profile);
    }
  }

  return {
    unNumber,
    variantCount: entries.length,
    profiles: [...uniqueProfiles.values()].sort(compareProfiles),
  };
}
