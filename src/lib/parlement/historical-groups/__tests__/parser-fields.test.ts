import { describe, expect, it } from "vitest";
import { parseActeur } from "../parse-amo30";
import { parseScrutin } from "../parse-scrutin";
import {
  acteurFile,
  groupMandate,
  groupNodes,
  scrutinFile,
  seatMandate,
} from "../__fixtures__/official-files";

const accepted = (raw: unknown) => {
  const parsed = parseActeur(raw);
  if (parsed.status !== "ACCEPTED") throw new Error("fixture");
  return parsed;
};

describe("the fields the parsers now read (lot 5C-0)", () => {
  it("reads the precedence and the publication date of a group mandate", () => {
    const actor = accepted(
      acteurFile("PA1", [
        { ...groupMandate("PM1", "PA1", "PO1"), preseance: "20", datePublication: "2022-06-29" },
      ])
    );
    expect(actor.membershipDetails).toEqual([
      { sourceRecordId: "PM1", precedence: 20, publicationDate: "2022-06-29" },
    ]);
    expect(actor.optionalFieldIssues).toBe(0);
  });

  it("reads a precedence of zero as zero, not as absent", () => {
    const actor = accepted(
      acteurFile("PA1", [{ ...groupMandate("PM1", "PA1", "PO1"), preseance: "0" }])
    );
    expect(actor.membershipDetails[0]?.precedence).toBe(0);
  });

  it("leaves both at null when the source publishes neither, without counting an issue", () => {
    const actor = accepted(acteurFile("PA1", [groupMandate("PM1", "PA1", "PO1")]));
    expect(actor.membershipDetails).toEqual([
      { sourceRecordId: "PM1", precedence: null, publicationDate: null },
    ]);
    expect(actor.optionalFieldIssues).toBe(0);
  });

  it("counts a value that is present and unreadable instead of dropping it silently, and keeps the mandate", () => {
    const actor = accepted(
      acteurFile("PA1", [
        {
          ...groupMandate("PM1", "PA1", "PO1"),
          preseance: "premier",
          datePublication: "2022-02-30",
        },
      ])
    );
    expect(actor.memberships).toHaveLength(1);
    expect(actor.membershipDetails[0]).toEqual({
      sourceRecordId: "PM1",
      precedence: null,
      publicationDate: null,
    });
    expect(actor.optionalFieldIssues).toBe(2);
  });

  it("keeps one detail per membership, in the same order, and none for a rejected mandate", () => {
    const actor = accepted(
      acteurFile("PA1", [
        { ...groupMandate("PM1", "PA1", "PO1"), preseance: "5" },
        groupMandate("PM2", "PA1", "PO2", { start: "bad" }),
        seatMandate("PM3", "PA1"),
        { ...groupMandate("PM4", "PA1", "PO3"), preseance: "7" },
      ])
    );
    expect(actor.memberships.map((m) => m.sourceRecordId)).toEqual(["PM1", "PM4"]);
    expect(actor.membershipDetails.map((d) => [d.sourceRecordId, d.precedence])).toEqual([
      ["PM1", 5],
      ["PM4", 7],
    ]);
    expect(actor.rejectedMandates.map((r) => r.reason)).toEqual(["START_DATE_INVALID"]);
  });

  it("does not change what the resolver reads: the evidence has exactly the fields it had", () => {
    const actor = accepted(
      acteurFile("PA1", [
        { ...groupMandate("PM1", "PA1", "PO1"), preseance: "20", datePublication: "2022-06-29" },
      ])
    );
    expect(Object.keys(actor.memberships[0] ?? {}).sort()).toEqual(
      [
        "chamber",
        "endDate",
        "endState",
        "groupRef",
        "isPrincipal",
        "legislature",
        "officialId",
        "qualityCode",
        "sourceRecordId",
        "startDate",
        "startState",
      ].sort()
    );
  });

  describe("parDelegation of a voter", () => {
    const delegation = (value: unknown) => {
      const file = scrutinFile("VTANR5L16V1", [{ organ: "PO1", pour: [{ actor: "PA1" }] }]);
      const votant = (
        groupNodes(file)[0]!.vote.decompteNominatif!["pours"] as {
          votant: Record<string, unknown>[];
        }
      ).votant[0] as Record<string, unknown>;
      if (value === undefined) delete votant["parDelegation"];
      else votant["parDelegation"] = value;
      const parsed = parseScrutin(file);
      if (parsed.status !== "AN") throw new Error("fixture");
      return parsed.scrutin.attestations[0]?.byDelegation;
    };

    it.each([
      ["true", true],
      ["false", false],
      [undefined, null],
      ["peut-être", null],
      [1, null],
    ])("%j gives %j", (value, expected) => {
      expect(delegation(value)).toBe(expected);
    });

    it("rejects nothing it used to accept: an odd value does not reject the scrutin", () => {
      expect(delegation("peut-être")).toBeNull();
    });
  });
});
