import { territoireCommunePath } from "./paths";

/** INSEE code at the end of a local mandate label: "Carcassonne (11069)", "Ajaccio (2A004)". */
const INSEE_SUFFIX = /\(([0-9]{5}|2[AB][0-9]{3})\)$/;

export interface MandateCommuneLinkInput {
  isCurrent: boolean;
  constituency: string | null;
  /** As stored in the profile document: `commune` is set only when the mandate links a commune. */
  localData?: { commune?: unknown } | null;
}

/**
 * Link from a local mandate to its Territoires commune page (#1052, Liens.html P1).
 *
 * Current mandates only: a past mandate gets no link rather than one without the « historique »
 * wording. The commune must exist in the base, which the profile document already proves through
 * `localData.commune` (a foreign key to Commune), so no extra read is needed. The code is taken
 * from the label, measured on production on 2026-10-11 to equal `MandateLocal.communeId` on every
 * row that carries one; a label without a code yields no link rather than a guessed one.
 */
export function mandateTerritoireHref(mandate: MandateCommuneLinkInput): string | null {
  if (!mandate.isCurrent || !mandate.localData?.commune) return null;
  const code = mandate.constituency?.trim().match(INSEE_SUFFIX)?.[1];
  return code ? territoireCommunePath(code) : null;
}
