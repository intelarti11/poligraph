/**
 * The privileges each role of the lot 5D must hold, written out by hand. It does not come from the
 * generator that produced the SQL: the tests compare the SQL and the catalog with this table, so a
 * mistake in the generator shows up as a difference instead of being copied on both sides.
 */
export const ROLES = ["hg_importer", "hg_runner", "hg_reader"] as const;
export type Role = (typeof ROLES)[number];

export const RECORDS = [
  "OfficialActor",
  "OfficialOrganRecord",
  "GroupMembershipRecord",
  "SeatMandateRecord",
  "ScrutinVoterAttestation",
  "ScrutinCountCheck",
  "ScrutinGroupCountCheck",
];
export const EXPECTED: Record<
  Role,
  { select: string[]; insert: string[]; update: Record<string, string[]> }
> = {
  hg_importer: {
    select: ["SourceArtifact", "OfficialSourceSnapshot", "SnapshotDecision", ...RECORDS],
    insert: ["SourceArtifact", "OfficialSourceSnapshot", "SnapshotDecision", ...RECORDS],
    update: {
      SourceArtifact: ["lastVerifiedAt"],
      ...Object.fromEntries(RECORDS.map((t) => [t, ["toSeq"]])),
    },
  },
  hg_runner: {
    select: [
      "OfficialSourceSnapshot",
      "SnapshotDecision",
      ...RECORDS,
      "HistoricalResolutionRun",
      "HistoricalRunSnapshotPin",
      "RunExclusion",
      "ScrutinOrganPosition",
      "OfficialActorLinkDecision",
      "OrganContinuityDecision",
    ],
    insert: [
      "HistoricalResolutionRun",
      "HistoricalRunSnapshotPin",
      "RunExclusion",
      "ScrutinOrganPosition",
    ],
    update: {
      HistoricalResolutionRun: ["finishedAt", "outputHash", "status", "statusCounts"],
    },
  },
  hg_reader: {
    select: [
      "SourceArtifact",
      "OfficialSourceSnapshot",
      "SnapshotDecision",
      ...RECORDS,
      "HistoricalResolutionRun",
      "HistoricalRunSnapshotPin",
      "RunExclusion",
      "ScrutinOrganPosition",
    ],
    insert: [],
    update: {},
  },
};
