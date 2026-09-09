import { PRIMARY_HAZARD_CLASSES } from './class-normalization';
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
  /**
   * A recognized primary hazard class or division. A stored class outside the
   * authorized vocabulary is reported as UNSPECIFIED_PRIMARY_HAZARD rather
   * than verbatim — see `redactPrimaryClass`.
   */
  readonly primaryClass: string;
  /**
   * Resolved hazard-class tokens. A subsidiary value the converter could not
   * resolve mechanically is reported as UNSPECIFIED_SUBSIDIARY_HAZARD rather
   * than as its `UNRESOLVED_*` token — see `redactSubsidiaryRisks`.
   */
  readonly subsidiaryRisks: readonly string[];
  /** Null only while the service runs against a pre-schema-v3 dataset. */
  readonly properShippingName: string | null;
}

/** Prefix the converter uses for source content it could not resolve mechanically. */
const UNRESOLVED_TOKEN_PREFIX = 'UNRESOLVED_';

/**
 * Public stand-in for a subsidiary hazard the converter could not resolve.
 *
 * The stored token carries the unresolved source value inline
 * (`UNRESOLVED_SOURCE:<raw cell text>`), so passing `subsidiaryRisks` through
 * verbatim published authorized workbook text through the batch API — the
 * mobile client renders this list directly. The fact that an unresolved
 * subsidiary hazard exists is preserved, because it is why the pair fails
 * closed to REVIEW_REQUIRED; only the source payload is withheld.
 */
export const UNSPECIFIED_SUBSIDIARY_HAZARD = 'UNSPECIFIED_SUBSIDIARY_HAZARD';

function redactSubsidiaryRisks(risks: readonly string[]): string[] {
  const redacted: string[] = [];
  for (const risk of risks) {
    const value = risk.startsWith(UNRESOLVED_TOKEN_PREFIX) ? UNSPECIFIED_SUBSIDIARY_HAZARD : risk;
    // Two variants whose only difference was the withheld payload would
    // otherwise present as distinct profiles a client cannot tell apart.
    if (!redacted.includes(value)) {
      redacted.push(value);
    }
  }
  return redacted;
}

/**
 * Public stand-in for a primary hazard class the converter could not map.
 *
 * `parsePrimaryClass` deliberately keeps an unrecognized "Class or division"
 * cell as the stored primary class: an unmapped class matches no class rule,
 * so the pair fails closed to REVIEW_REQUIRED with no special-case logic.
 * That makes the stored value private authorized source content, and
 * publishing `primaryClass` verbatim handed it to any batch caller. The class
 * being unusable is still reported — only the source payload is withheld.
 */
export const UNSPECIFIED_PRIMARY_HAZARD = 'UNSPECIFIED_PRIMARY_HAZARD';

/** Allowlist, not a denylist: only the authorized vocabulary is publishable. */
const RECOGNIZED_PRIMARY_CLASSES: ReadonlySet<string> = new Set<string>(PRIMARY_HAZARD_CLASSES);

/**
 * Maps a stored primary class to its public value: a recognized class or
 * division passes through unchanged, anything else becomes
 * UNSPECIFIED_PRIMARY_HAZARD. Pure.
 *
 * Membership is tested against the authorized vocabulary rather than by
 * pattern-matching or by excluding known markers, so unmapped source prose, a
 * malformed class-shaped value, an `UNRESOLVED_*` token and a legacy class
 * stored by an older dataset are all withheld without needing to be
 * enumerated.
 */
function redactPrimaryClass(primaryClass: string): string {
  return RECOGNIZED_PRIMARY_CLASSES.has(primaryClass) ? primaryClass : UNSPECIFIED_PRIMARY_HAZARD;
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
    // Redaction happens here, before the profile is built, keyed or sorted, so
    // no withheld value can reach the response or influence its shape.
    const primaryClass = redactPrimaryClass(entry.primaryClass);
    const subsidiaryRisks = redactSubsidiaryRisks(entry.subsidiaryRisks);
    const profile: DgSummaryProfile = {
      primaryClass,
      subsidiaryRisks,
      properShippingName: entry.properShippingName,
    };
    // Keyed on the visible fields exactly as serialized, so two variants are
    // deduplicated only when a client could not tell them apart — including
    // two variants whose only difference is a withheld payload. The null name
    // is keyed distinctly from any string name.
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
