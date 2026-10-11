import { z } from "zod/v4";

/**
 * Admin input for curated territorial decisions (#1052, lot 2).
 *
 * Every text is bounded and trimmed. URLs are stored and rendered as links, never fetched by
 * the server: the http(s) restriction keeps `javascript:` and `data:` out of an `href`, and a
 * URL carrying credentials is refused rather than shown.
 */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar day "YYYY-MM-DD", stored at UTC midnight. "2026-02-30" is refused, not rolled over. */
export const isoDay = z
  .string()
  .regex(ISO_DAY, "Date attendue au format AAAA-MM-JJ")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Date invalide")
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

export function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password
    );
  } catch {
    return false;
  }
}

export const httpUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(isHttpUrl, "URL http ou https attendue, sans identifiants");

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((value) => (value ? value : null));

const COMMUNE_CODE = /^([0-9]{5}|2[AB][0-9]{3})$/;
const SIREN = /^[0-9]{9}$/;

export const createInstitutionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("CONSEIL_MUNICIPAL"),
    name: text(200),
    communeId: z.string().regex(COMMUNE_CODE, "Code INSEE invalide"),
  }),
  z.strictObject({
    kind: z.literal("CONSEIL_COMMUNAUTAIRE"),
    name: text(200),
    sirenEpci: z.string().regex(SIREN, "SIREN à 9 chiffres attendu"),
  }),
]);

export const TERRITORIAL_SOURCE_KIND_VALUES = [
  "DELIBERATION",
  "PROCES_VERBAL",
  "LISTE_DELIBERATIONS",
  "RECUEIL_ACTES_ADMINISTRATIFS",
] as const;

const sourceFields = {
  kind: z.enum(TERRITORIAL_SOURCE_KIND_VALUES),
  title: text(300),
  producer: text(200),
  url: httpUrl,
  archiveUrl: z
    .union([httpUrl, z.literal(""), z.null()])
    .optional()
    .transform((value) => (value ? value : null)),
  documentDate: z
    .union([isoDay, z.literal(""), z.null()])
    .optional()
    .transform((value) => (value instanceof Date ? value : null)),
  lastVerifiedAt: isoDay,
};

// Updates replace the whole record: a partial schema would turn every absent optional field
// into null through its transform and erase it.
export const territorialSourceSchema = z.strictObject(sourceFields);

const DATE_PRECISION_VALUES = ["DAY", "MONTH", "YEAR"] as const;
const DECISION_OUTCOME_VALUES = ["ADOPTEE", "REJETEE"] as const;

const decisionFields = {
  institutionId: z.string().min(1).max(64),
  communeId: z.string().regex(COMMUNE_CODE, "Code INSEE invalide"),
  reference: optionalText(120),
  title: text(500),
  adoptionDate: isoDay,
  adoptionDatePrecision: z.enum(DATE_PRECISION_VALUES),
  publicationDate: z
    .union([isoDay, z.literal(""), z.null()])
    .optional()
    .transform((value) => (value instanceof Date ? value : null)),
  effectiveDate: z
    .union([isoDay, z.literal(""), z.null()])
    .optional()
    .transform((value) => (value instanceof Date ? value : null)),
  outcome: z.enum(DECISION_OUTCOME_VALUES),
  outcomeWording: optionalText(300),
  sourceId: z.string().min(1).max(64),
  sourceLocator: text(200),
};

/** Create and update alike: an update replaces the whole notice (see territorialSourceSchema). */
export const decisionSchema = z.strictObject(decisionFields);

export const DECISION_TRANSITION_ACTIONS = [
  "SUBMIT",
  "RETURN_TO_DRAFT",
  "PUBLISH",
  "REJECT",
  "UNPUBLISH",
  "REOPEN",
] as const;

export const decisionTransitionSchema = z.strictObject({
  action: z.enum(DECISION_TRANSITION_ACTIONS),
  /** Name of the person who reviewed the notice against its source. Required to publish. */
  reviewedBy: optionalText(100),
  /** Required to reject or unpublish: the reason stays in the audit trail. */
  reason: optionalText(500),
});

export type CreateInstitutionInput = z.infer<typeof createInstitutionSchema>;
export type DecisionInput = z.infer<typeof decisionSchema>;
export type TerritorialSourceInput = z.infer<typeof territorialSourceSchema>;
export type DecisionTransitionInput = z.infer<typeof decisionTransitionSchema>;
