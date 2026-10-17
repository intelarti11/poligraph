import type { IdentityOutcome, OfficialActorId } from "./types";

/**
 * From a PoliGraph profile to an official actor, using the manual decisions in force.
 *
 * The official actor is the key of the evidence; the profile is a link laid on top of it, and the
 * link may be missing. A missing or doubtful link is an answer (`UNRESOLVED`), never a guess:
 * nothing is matched on a name.
 */

export type ActorLinkStatus =
  | "LINKED_OFFICIAL_ID"
  | "LINKED_EXTERNAL_ID"
  | "LINKED_MANUAL"
  | "AMBIGUOUS"
  | "NONE";

/** A decision in force about one official actor. */
export interface ActorLinkDecision {
  officialId: OfficialActorId;
  politicianId: string | null;
  status: ActorLinkStatus;
}

const LINKED: ReadonlySet<ActorLinkStatus> = new Set([
  "LINKED_OFFICIAL_ID",
  "LINKED_EXTERNAL_ID",
  "LINKED_MANUAL",
]);

export function identityForPolitician(
  profile: { politicianId: string; officialIdOnProfile: string | null },
  inForce: Iterable<ActorLinkDecision>
): IdentityOutcome {
  const mine = [...inForce].filter((decision) => decision.politicianId === profile.politicianId);
  const linked = mine.filter((decision) => LINKED.has(decision.status));
  const actors = new Set(linked.map((decision) => decision.officialId));
  if (actors.size === 1) {
    return { status: "RESOLVED", officialId: [...actors][0] as OfficialActorId };
  }
  if (actors.size > 1 || mine.some((decision) => decision.status === "AMBIGUOUS")) {
    return { status: "UNRESOLVED", reason: "AMBIGUOUS_LINK" };
  }
  return {
    status: "UNRESOLVED",
    reason: profile.officialIdOnProfile === null ? "NO_OFFICIAL_ID" : "NO_LINK",
  };
}
