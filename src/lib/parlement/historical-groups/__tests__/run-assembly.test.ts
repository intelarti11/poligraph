import { describe, expect, it } from "vitest";
import { civilDate } from "../civil-date";
import { hashOf } from "../canonical";
import type {
  GroupMembershipRow,
  OfficialOrganRow,
  ScrutinAttestationRow,
  SeatMandateRow,
} from "../rows";
import { buildEvidenceStore, buildVote, SeatMandateRefError, voteIdOf } from "../run-assembly";

const d = civilDate;
const organ = (ref: string, label: string, abbreviation: string | null): OfficialOrganRow => ({
  organeRef: ref,
  codeType: "GP",
  legislature: 16,
  label,
  abbreviation,
  startDate: d("2022-06-28"),
  endDate: null,
});
const membership = (
  id: string,
  official: string,
  group: string,
  quality: string
): GroupMembershipRow => ({
  sourceRecordId: id,
  officialId: official,
  chamber: "AN",
  groupRef: group,
  legislature: 16,
  qualityCode: quality,
  isPrincipal: true,
  precedence: 1,
  startDate: d("2022-06-29"),
  startState: "DATED",
  endDate: null,
  endState: "OPEN_AT_SNAPSHOT",
  publicationDate: d("2022-06-29"),
});
const attestation = (over: Partial<ScrutinAttestationRow> = {}): ScrutinAttestationRow => ({
  scrutinExternalId: "VT1",
  officialId: "PA1",
  scrutinDate: d("2023-03-14"),
  legislature: 16,
  publishedOrganRef: "PO1",
  publishedPosition: "pour",
  byDelegation: false,
  seatMandateRef: "PM1",
  ...over,
});
const seat = (over: Partial<SeatMandateRow> = {}): SeatMandateRow => ({
  sourceRecordId: "PM1",
  officialId: "PA1",
  legislature: 16,
  startDate: d("2022-06-22"),
  startState: "DATED",
  endDate: null,
  endState: "OPEN_AT_SNAPSHOT",
  ...over,
});

describe("the evidence of a run, from stored rows", () => {
  const organs = [
    organ("PO1", "Groupe un", "G1"),
    organ("PO2", "Non inscrits", "NI"),
    organ("PO3", "Groupe douteux", "NI"),
  ];
  const memberships = [
    membership("M1", "PA1", "PO1", "Membre"),
    membership("M2", "PA2", "PO2", "Député non-inscrit"),
    membership("M3", "PA3", "PO3", "Membre"),
  ];

  it("recomputes the kind of each organ and leaves out one the signals do not settle", () => {
    const { store, unclassifiedOrgans } = buildEvidenceStore({ seq: 4, organs, memberships });
    expect(store.organs.map((o) => [o.key, o.value.kind])).toEqual([
      ["PO1", "GROUP"],
      ["PO2", "NON_INSCRIT"],
    ]);
    expect(unclassifiedOrgans).toEqual(["PO3"]);
  });

  it("holds every version at the pinned snapshot, hashed as the resolver reads it", () => {
    const { store } = buildEvidenceStore({ seq: 4, organs, memberships });
    for (const v of [...store.memberships, ...store.organs]) {
      expect(v.fromSeq).toBe(4);
      expect(v.toSeq).toBeNull();
      expect(v.rawHash).toBe(hashOf(v.value));
    }
    expect(store.continuityJournal).toEqual([]);
  });

  it("keeps the columns the resolver does not read out of the evidence", () => {
    const { store } = buildEvidenceStore({ seq: 1, organs, memberships });
    const value = store.memberships[0]?.value as unknown as Record<string, unknown>;
    expect(value).not.toHaveProperty("precedence");
    expect(value).not.toHaveProperty("publicationDate");
  });
});

describe("a vote of a run, from an attestation", () => {
  const seats = new Map([["PM1", seat()]]);

  it("is identified by the scrutin and the official actor, resolved without any profile", () => {
    const vote = buildVote(attestation(), seats);
    expect(vote.voteId).toBe(voteIdOf("VT1", "PA1"));
    expect(vote.identity).toEqual({ status: "RESOLVED", officialId: "PA1" });
    expect(vote.position).toBe("POUR");
    expect(vote.attestation?.seatMandate).toEqual({ startDate: d("2022-06-22"), endDate: null });
  });

  it.each([
    ["pour", "POUR"],
    ["contre", "CONTRE"],
    ["abstention", "ABSTENTION"],
    ["nonVotant", "NON_VOTANT"],
  ] as const)("maps the published position %s", (published, expected) => {
    expect(buildVote(attestation({ publishedPosition: published }), seats).position).toBe(expected);
  });

  it("carries no seat mandate when the attestation names none", () => {
    expect(
      buildVote(attestation({ seatMandateRef: null }), seats).attestation?.seatMandate
    ).toBeNull();
  });

  it("stops on a seat mandate that is not there, and on one that belongs to another actor", () => {
    expect(() => buildVote(attestation({ seatMandateRef: "PM9" }), seats)).toThrow(
      SeatMandateRefError
    );
    expect(() => buildVote(attestation(), new Map([["PM1", seat({ officialId: "PA2" })]]))).toThrow(
      SeatMandateRefError
    );
  });
});
