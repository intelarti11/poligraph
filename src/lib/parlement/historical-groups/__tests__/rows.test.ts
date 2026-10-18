// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson, computeStateHash } from "../canonical";
import { civilDate } from "../civil-date";
import { parseActeur, parseOrgane, type ActorParse } from "../parse-amo30";
import { parseScrutin, type ParsedAnScrutin } from "../parse-scrutin";
import { buildRecordCounts, validateRecordCounts } from "../record-counts";
import {
  hashed,
  organRow,
  RECORD_KINDS,
  rawHashOf,
  recordKeyOf,
  recordsOfActor,
  recordsOfScrutin,
  rowText,
  stateHashOfRecords,
  type HashedRecord,
  type RecordKind,
  type RowOf,
} from "../rows";
import { applySnapshot, stateAt, type RecordVersion } from "../versioning";
import { SAMPLE_ROWS } from "../__fixtures__/row-samples";
import {
  acteurFile,
  groupMandate,
  groupNodes,
  organeFile,
  scrutinFile,
  seatMandate,
  type GroupSpec,
} from "../__fixtures__/official-files";

// ---------------------------------------------------------------------------------------------
// What rawHash is. Three of these values were recomputed outside this code, in Python, from the
// definition `sha256(canonical JSON of {kind, row})`: the hash is a definition, not an accident.
// ---------------------------------------------------------------------------------------------

const GOLDEN: Record<RecordKind, string> = {
  OFFICIAL_ACTOR: "ad52197074f09836eb14910bde63b1c89d4d50720e068469d3c1eb10f968dc07",
  OFFICIAL_ORGAN: "0a6e163085a3a32fe4a9d89f1258c2bad73f43c90ef32423956eb5b44b039881",
  GROUP_MEMBERSHIP: "e3215a6ff7519bb0e6a2b670f70c7fc6d47abcf1dc4e1c63f55f80e1e94bc8b6",
  SEAT_MANDATE: "c66dbff984acf8b266009ff69f7ddf2fb7a507a0a247cdbfd6269ce9b6a93134",
  SCRUTIN_ATTESTATION: "737b7b4814d826e2200e6dd1082b68ba5bd944e9d9f57184724b07ce120415bc",
  SCRUTIN_COUNT_CHECK: "03fa35d079a43b5726e4377d0a676f02a45cc1eb7961a4f401d3b946a49cf9b4",
  SCRUTIN_GROUP_COUNT_CHECK: "ae8066ea860f21c05a80e95cdbf706fb311f2932105c693c0c03220ae74ec313",
};

const rawHash = <K extends RecordKind>(kind: K, row: RowOf[K]) => rawHashOf(kind, row);

describe("rawHash: the definition", () => {
  it.each(RECORD_KINDS)("%s has the hash the definition gives", (kind) => {
    expect(rawHash(kind, SAMPLE_ROWS[kind] as never)).toBe(GOLDEN[kind]);
  });

  it("is the SHA-256 of the canonical text of {kind, row}, with sorted keys and no space", () => {
    expect(rowText("OFFICIAL_ACTOR", { officialId: "PA000001" })).toBe(
      '{"kind":"OFFICIAL_ACTOR","row":{"officialId":"PA000001"}}'
    );
  });

  it("does not depend on the order of the columns", () => {
    const row = SAMPLE_ROWS.GROUP_MEMBERSHIP;
    const shuffled = Object.fromEntries(Object.entries(row).reverse()) as typeof row;
    expect(Object.keys(shuffled)[0]).not.toBe(Object.keys(row)[0]);
    expect(rawHash("GROUP_MEMBERSHIP", shuffled)).toBe(rawHash("GROUP_MEMBERSHIP", row));
  });

  it.each(RECORD_KINDS)("%s: changing any one column changes the hash", (kind) => {
    const row = SAMPLE_ROWS[kind] as unknown as Record<string, unknown>;
    const base = rawHash(kind, row as never);
    for (const [column, value] of Object.entries(row)) {
      const changed: unknown =
        typeof value === "string"
          ? /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? "2001-01-01"
            : `${value}x`
          : typeof value === "number"
            ? value + 1
            : typeof value === "boolean"
              ? !value
              : value;
      expect(rawHash(kind, { ...row, [column]: changed } as never), `${kind}.${column}`).not.toBe(
        base
      );
    }
  });

  it.each(RECORD_KINDS)(
    "%s: a value that becomes absent changes the hash, null is a value",
    (kind) => {
      const row = SAMPLE_ROWS[kind] as unknown as Record<string, unknown>;
      const base = rawHash(kind, row as never);
      const nullable = Object.entries(row).filter(
        ([column]) =>
          ![
            "scrutinExternalId",
            "officialId",
            "sourceRecordId",
            "organeRef",
            "organRef",
            "organOrdinal",
          ].includes(column)
      );
      for (const [column] of nullable) {
        expect(
          rawHash(kind, { ...row, [column]: null } as never),
          `${kind}.${column} -> null`
        ).not.toBe(base);
      }
    }
  );

  it("refuses what would be serialized by accident: undefined, a float, a date object", () => {
    const row = SAMPLE_ROWS.GROUP_MEMBERSHIP as unknown as Record<string, unknown>;
    expect(() => rawHash("GROUP_MEMBERSHIP", { ...row, precedence: undefined } as never)).toThrow(
      /undefined/
    );
    expect(() => rawHash("GROUP_MEMBERSHIP", { ...row, precedence: 1.5 } as never)).toThrow(
      /safe integer/
    );
    expect(() =>
      rawHash("GROUP_MEMBERSHIP", { ...row, startDate: new Date(0) } as never)
    ).toThrow();
  });

  it("puts the kind in the hash: two tables never share a hash for the same payload", () => {
    const payload = { scrutinExternalId: "V1", organRef: "PO1", organOrdinal: 0 };
    expect(canonicalJson({ kind: "SCRUTIN_GROUP_COUNT_CHECK", row: payload })).not.toBe(
      canonicalJson({ kind: "SCRUTIN_COUNT_CHECK", row: payload })
    );
    expect(new Set(Object.values(GOLDEN)).size).toBe(RECORD_KINDS.length);
  });

  it("builds the identity as a JSON array, so a separator inside a value cannot merge two keys", () => {
    const a = recordKeyOf("SCRUTIN_ATTESTATION", {
      ...SAMPLE_ROWS.SCRUTIN_ATTESTATION,
      scrutinExternalId: "A|B",
      officialId: "C",
    });
    const b = recordKeyOf("SCRUTIN_ATTESTATION", {
      ...SAMPLE_ROWS.SCRUTIN_ATTESTATION,
      scrutinExternalId: "A",
      officialId: "B|C",
    });
    expect(a).not.toBe(b);
    expect(recordKeyOf("SCRUTIN_ATTESTATION", SAMPLE_ROWS.SCRUTIN_ATTESTATION)).toBe(
      '["VTANR5L16V1","PA000001"]'
    );
  });
});

// ---------------------------------------------------------------------------------------------
// The rows are the columns of the tables.
// ---------------------------------------------------------------------------------------------

const TABLE_OF: Record<RecordKind, string> = {
  OFFICIAL_ACTOR: "OfficialActor",
  OFFICIAL_ORGAN: "OfficialOrganRecord",
  GROUP_MEMBERSHIP: "GroupMembershipRecord",
  SEAT_MANDATE: "SeatMandateRecord",
  SCRUTIN_ATTESTATION: "ScrutinVoterAttestation",
  SCRUTIN_COUNT_CHECK: "ScrutinCountCheck",
  SCRUTIN_GROUP_COUNT_CHECK: "ScrutinGroupCountCheck",
};
const NOT_CONTENT = new Set([
  "stream",
  "fromSeq",
  "toSeq",
  "sourceMember",
  "memberHash",
  "rawHash",
]);

function columnsOf(sql: string, table: string): string[] {
  const real = sql.split("-- hg:real-build")[1] ?? "";
  const block =
    new RegExp(`CREATE TABLE IF NOT EXISTS "${table}" \\(\\n([\\s\\S]*?)\\n\\);`).exec(real)?.[1] ??
    "";
  return [...block.matchAll(/^ {4}"(\w+)" [A-Z]/gm)].map((m) => m[1] as string);
}
const SQL_5B = readFileSync(
  "prisma/migrations/manual/2026-10-18-historical-groups-schema.sql",
  "utf8"
);
const SQL_5C0 = readFileSync(
  "prisma/migrations/manual/2026-10-19-historical-groups-count-check.sql",
  "utf8"
);

describe("a row holds exactly the content columns of its table", () => {
  it.each(RECORD_KINDS)("%s", (kind) => {
    const table = TABLE_OF[kind];
    const columns =
      columnsOf(SQL_5B, table).length > 0 ? columnsOf(SQL_5B, table) : columnsOf(SQL_5C0, table);
    expect(columns.length, `${table} found in the SQL`).toBeGreaterThan(3);
    const content = columns.filter((c) => !NOT_CONTENT.has(c)).sort();
    expect(Object.keys(SAMPLE_ROWS[kind]).sort()).toEqual(content);
  });

  it("leaves the versioning and the provenance out of the hash", () => {
    for (const kind of RECORD_KINDS) {
      for (const excluded of NOT_CONTENT)
        expect(Object.keys(SAMPLE_ROWS[kind])).not.toContain(excluded);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// From the parsers to the rows.
// ---------------------------------------------------------------------------------------------

const accepted = (raw: unknown): Extract<ActorParse, { status: "ACCEPTED" }> => {
  const parsed = parseActeur(raw);
  if (parsed.status !== "ACCEPTED") throw new Error("fixture");
  return parsed;
};
const scrutin = (raw: unknown): ParsedAnScrutin => {
  const parsed = parseScrutin(raw);
  if (parsed.status !== "AN") throw new Error("fixture");
  return parsed.scrutin;
};
const voter = (n: number, mandate = "PS1") => ({ actor: `PA${n}`, mandate });

describe("rows from the parsers", () => {
  it("turns an actor into its rows, with the fields the source publishes beyond the evidence", () => {
    const actor = accepted(
      acteurFile("PA1", [
        { ...groupMandate("PM1", "PA1", "PO1"), preseance: "20", datePublication: "2022-06-29" },
        seatMandate("PM2", "PA1", { end: null }),
      ])
    );
    const rows = recordsOfActor(actor);
    expect(rows.map((r) => r.kind)).toEqual(["OFFICIAL_ACTOR", "GROUP_MEMBERSHIP", "SEAT_MANDATE"]);
    expect(rows[1]?.row).toMatchObject({
      precedence: 20,
      publicationDate: "2022-06-29",
      chamber: "AN",
      startState: "DATED",
      endState: "OPEN_AT_SNAPSHOT",
    });
    expect(rows[2]?.row).toMatchObject({
      endDate: null,
      endState: "OPEN_AT_SNAPSHOT",
      startState: "DATED",
    });
  });

  it("stores an organ as published, `PO0` and a missing start included", () => {
    const parsed = parseOrgane(organeFile("PO0", { abbreviation: null, start: null }));
    if (parsed.status !== "ACCEPTED") throw new Error("fixture");
    expect(organRow(parsed.organ).row).toMatchObject({
      organeRef: "PO0",
      abbreviation: null,
      startDate: null,
      codeType: "GP",
    });
  });

  it("keeps the placeholder group exactly as published", () => {
    const rows = recordsOfScrutin(
      scrutin(scrutinFile("VTANR5L17V501", [{ organ: "PO0", pour: [voter(1)] }]))
    );
    expect(rows.find((r) => r.kind === "SCRUTIN_ATTESTATION")?.row).toMatchObject({
      publishedOrganRef: "PO0",
    });
  });

  it("gives every group of a scrutin its own identity, even when the placeholder is listed twice", () => {
    const groups: GroupSpec[] = [
      { organ: "PO0", pour: [voter(1)] },
      { organ: "PO1", pour: [voter(2)] },
      { organ: "PO0", contre: [voter(3)] },
    ];
    const rows = recordsOfScrutin(scrutin(scrutinFile("VTANR5L17V501", groups)));
    const keys = rows.filter((r) => r.kind === "SCRUTIN_GROUP_COUNT_CHECK").map((r) => r.key);
    expect(keys).toEqual([
      '["VTANR5L17V501","PO0",0]',
      '["VTANR5L17V501","PO1",0]',
      '["VTANR5L17V501","PO0",1]',
    ]);
    expect(() => stateHashOfRecords(rows)).not.toThrow();
  });

  it("keeps every attestation of a scrutin whose counts disagree, and marks the disagreement", () => {
    const groups: GroupSpec[] = [
      {
        organ: "PO1",
        pour: [voter(1), voter(2)],
        official: { pour: 3, contre: 0, abstention: 0, nonVotant: 0 },
      },
    ];
    const rows = recordsOfScrutin(scrutin(scrutinFile("VTANR5L15V1", groups)));
    expect(rows.filter((r) => r.kind === "SCRUTIN_ATTESTATION")).toHaveLength(2);
    const check = rows.find((r) => r.kind === "SCRUTIN_COUNT_CHECK")
      ?.row as RowOf["SCRUTIN_COUNT_CHECK"];
    expect(check).toMatchObject({
      countCoherence: "COUNT_MISMATCH",
      mismatchedGroups: 1,
      nominalPour: 2,
      diffPour: 0,
    });
    const group = rows.find((r) => r.kind === "SCRUTIN_GROUP_COUNT_CHECK")
      ?.row as RowOf["SCRUTIN_GROUP_COUNT_CHECK"];
    expect(group).toMatchObject({
      groupCoherence: "COUNT_MISMATCH",
      nominalPour: 2,
      officialPour: 3,
      diffPour: -1,
    });
  });

  it("reads `parDelegation` and leaves the attestation otherwise as it was", () => {
    const file = scrutinFile("VTANR5L16V1", [
      { organ: "PO1", pour: [voter(1), voter(2), voter(3)] },
    ]);
    const votants = (
      groupNodes(file)[0]!.vote.decompteNominatif!["pours"] as { votant: Record<string, unknown>[] }
    ).votant;
    (votants[0] as Record<string, unknown>)["parDelegation"] = "true";
    (votants[1] as Record<string, unknown>)["parDelegation"] = "false";
    delete (votants[2] as Record<string, unknown>)["parDelegation"];
    const rows = recordsOfScrutin(scrutin(file)).filter((r) => r.kind === "SCRUTIN_ATTESTATION");
    expect(rows.map((r) => (r.row as RowOf["SCRUTIN_ATTESTATION"]).byDelegation)).toEqual([
      true,
      false,
      null,
    ]);
  });

  it("applies no mise au point: a correction block changes the count of listed voters and nothing else", () => {
    const groups: GroupSpec[] = [{ organ: "PO1", pour: [voter(1), voter(2)] }];
    const plain = recordsOfScrutin(scrutin(scrutinFile("VTANR5L16V1", groups)));
    const corrected = recordsOfScrutin(
      scrutin(
        scrutinFile("VTANR5L16V1", groups, {
          miseAuPoint: { contres: { votant: { acteurRef: "PA1", mandatRef: "PS1" } } },
        })
      )
    );
    const strip = (rs: HashedRecord[]) =>
      rs.filter((r) => r.kind !== "SCRUTIN_COUNT_CHECK").map((r) => r.rawHash);
    expect(strip(corrected)).toEqual(strip(plain));
    expect(
      (corrected.find((r) => r.kind === "SCRUTIN_COUNT_CHECK")?.row as RowOf["SCRUTIN_COUNT_CHECK"])
        .miseAuPointListedVotants
    ).toBe(1);
  });

  it("stops when the parser and the arithmetic disagree about the coherence", () => {
    const parsed = scrutin(scrutinFile("VTANR5L16V1", [{ organ: "PO1", pour: [voter(1)] }]));
    expect(() => recordsOfScrutin({ ...parsed, countCoherence: "COUNT_MISMATCH" })).toThrow(
      /parser says COUNT_MISMATCH, the numbers say COHERENT/
    );
  });

  it("carries no name: an actor file with a civil status block leaves no trace in any row", () => {
    const raw = acteurFile("PA1", [groupMandate("PM1", "PA1", "PO1")]);
    (raw["acteur"] as Record<string, unknown>)["etatCivil"] = {
      ident: { prenom: "Prénom", nom: "Nom" },
    };
    expect(JSON.stringify(recordsOfActor(accepted(raw)))).not.toMatch(/Prénom|"Nom"|etatCivil|nom/);
  });
});

// ---------------------------------------------------------------------------------------------
// Reproducibility, immutability, retroactive changes.
// ---------------------------------------------------------------------------------------------

function sampleRecords(): HashedRecord[] {
  const groups: GroupSpec[] = [
    { organ: "PO1", pour: [voter(1), voter(2)], contre: [voter(3)] },
    { organ: "PO2", abstention: [voter(4)] },
  ];
  const actor = accepted(
    acteurFile("PA1", [groupMandate("PM1", "PA1", "PO1"), seatMandate("PM2", "PA1")])
  );
  return [
    ...recordsOfActor(actor),
    ...recordsOfScrutin(scrutin(scrutinFile("VTANR5L16V1", groups))),
  ];
}

describe("reproducibility", () => {
  it("gives the same rows, hashes and state hash from the same input, run after run", () => {
    const a = sampleRecords();
    const b = sampleRecords();
    expect(b).toEqual(a);
    expect(stateHashOfRecords(b)).toBe(stateHashOfRecords(a));
  });

  it("gives the same state hash whatever the order the records were read in", () => {
    const records = sampleRecords();
    const reversed = [...records].reverse();
    const rotated = [...records.slice(3), ...records.slice(0, 3)];
    expect(stateHashOfRecords(reversed)).toBe(stateHashOfRecords(records));
    expect(stateHashOfRecords(rotated)).toBe(stateHashOfRecords(records));
  });

  it("is the state hash of the sorted (kind, key, rawHash) triples, nothing more", () => {
    const records = sampleRecords();
    expect(stateHashOfRecords(records)).toBe(
      computeStateHash(records.map((r) => ({ kind: r.kind, key: r.key, rawHash: r.rawHash })))
    );
  });

  it("changes the state hash when one record changes, and only the hash of that record", () => {
    const records = sampleRecords();
    const target = records.findIndex((r) => r.kind === "SCRUTIN_ATTESTATION");
    const changed = records.map((r, i) =>
      i === target
        ? hashed("SCRUTIN_ATTESTATION", {
            ...(r.row as RowOf["SCRUTIN_ATTESTATION"]),
            publishedPosition: "contre",
          })
        : r
    );
    expect(stateHashOfRecords(changed)).not.toBe(stateHashOfRecords(records));
    expect(changed.filter((r, i) => r.rawHash !== records[i]?.rawHash)).toHaveLength(1);
    expect(changed[target]?.key).toBe(records[target]?.key);
  });

  it("refuses a state with two versions of one record", () => {
    const records = sampleRecords();
    expect(() => stateHashOfRecords([...records, records[0] as HashedRecord])).toThrow(
      /two versions/
    );
  });
});

describe("immutability and retroactive changes, through the versioning of the lot", () => {
  type Row = HashedRecord;
  const asIncoming = (records: HashedRecord[]) =>
    records.map((r) => ({ key: `${r.kind}|${r.key}`, rawHash: r.rawHash, value: r }));
  const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === "object") {
      Object.freeze(value);
      for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
  };

  it("adds the first snapshot, finds nothing to change in the second, and never mutates its input", () => {
    const first = deepFreeze(asIncoming(sampleRecords()));
    const one = applySnapshot<Row>([], first, 1);
    expect(one.diff.added).toHaveLength(first.length);
    const frozenVersions = deepFreeze(one.versions);
    const two = applySnapshot<Row>(frozenVersions, deepFreeze(asIncoming(sampleRecords())), 2);
    expect(two.diff).toMatchObject({ added: [], corrected: [], removed: [] });
    expect(two.diff.unchanged).toHaveLength(first.length);
    expect(two.versions).toEqual(one.versions);
  });

  it("keeps the old version when a scrutin is corrected: the state at snapshot 1 does not move", () => {
    const v1Records = sampleRecords();
    const v1 = applySnapshot<Row>([], asIncoming(v1Records), 1).versions;
    const hashAt1Before = stateHashOfRecords(stateAt(v1, 1).map((v) => v.value));

    // The Assemblée corrects a published group count: the scrutin was discordant, it now agrees.
    const groups: GroupSpec[] = [
      {
        organ: "PO1",
        pour: [voter(1), voter(2)],
        contre: [voter(3)],
        official: { pour: 9, contre: 1, abstention: 0, nonVotant: 0 },
      },
      { organ: "PO2", abstention: [voter(4)] },
    ];
    const mismatched = recordsOfScrutin(scrutin(scrutinFile("VTANR5L16V1", groups)));
    expect(
      (
        mismatched.find((r) => r.kind === "SCRUTIN_COUNT_CHECK")
          ?.row as RowOf["SCRUTIN_COUNT_CHECK"]
      ).countCoherence
    ).toBe("COUNT_MISMATCH");
    const base = recordsOfActor(
      accepted(acteurFile("PA1", [groupMandate("PM1", "PA1", "PO1"), seatMandate("PM2", "PA1")]))
    );
    const v2 = applySnapshot<Row>(v1, asIncoming([...base, ...mismatched]), 2);

    expect(v2.diff.corrected.sort()).toEqual(
      [
        `SCRUTIN_COUNT_CHECK|${recordKeyOf("SCRUTIN_COUNT_CHECK", { ...SAMPLE_ROWS.SCRUTIN_COUNT_CHECK, scrutinExternalId: "VTANR5L16V1" })}`,
        `SCRUTIN_GROUP_COUNT_CHECK|["VTANR5L16V1","PO1",0]`,
      ].sort()
    );
    expect(v2.diff.added).toEqual([]);
    expect(v2.diff.removed).toEqual([]);
    // Nothing was deleted or rewritten: the earlier state is read back identically.
    expect(stateHashOfRecords(stateAt(v2.versions, 1).map((v) => v.value))).toBe(hashAt1Before);
    const checkAt = (versions: RecordVersion<Row>[], seq: number) =>
      (
        stateAt(versions, seq).find((v) => v.value.kind === "SCRUTIN_COUNT_CHECK")?.value
          .row as RowOf["SCRUTIN_COUNT_CHECK"]
      ).countCoherence;
    expect(checkAt(v2.versions, 1)).toBe("COHERENT");
    expect(checkAt(v2.versions, 2)).toBe("COUNT_MISMATCH");
    expect(v2.versions.filter((v) => v.toSeq !== null)).toHaveLength(2);
  });

  it("closes a version when a record disappears, and reopens it when it comes back", () => {
    const records = sampleRecords();
    const v1 = applySnapshot<Row>([], asIncoming(records), 1).versions;
    const withoutAttestation = records.filter(
      (r) => !(r.kind === "SCRUTIN_ATTESTATION" && r.key.includes("PA3"))
    );
    const v2 = applySnapshot<Row>(v1, asIncoming(withoutAttestation), 2);
    expect(v2.diff.removed).toHaveLength(1);
    const v3 = applySnapshot<Row>(v2.versions, asIncoming(records), 3);
    expect(v3.diff.added).toHaveLength(1);
    expect(stateAt(v3.versions, 2)).toHaveLength(records.length - 1);
    expect(stateAt(v3.versions, 1)).toHaveLength(records.length);
  });
});

describe("recordCounts", () => {
  const files = {
    total: 5,
    accepted: 3,
    outOfScope: 1,
    rejected: 1,
    rejectedByReason: { DATE_INVALID: 1 },
  };

  it("counts every kind, the placeholder attestations and the scrutins by coherence", () => {
    const groups: GroupSpec[] = [
      {
        organ: "PO0",
        pour: [voter(1), voter(2)],
        official: { pour: 5, contre: 0, abstention: 0, nonVotant: 0 },
      },
    ];
    const records = [
      ...sampleRecords(),
      ...recordsOfScrutin(scrutin(scrutinFile("VTANR5L17V9", groups))),
    ];
    const counts = buildRecordCounts({ files, records });
    expect(counts.rows).toMatchObject({
      OFFICIAL_ACTOR: 1,
      GROUP_MEMBERSHIP: 1,
      SEAT_MANDATE: 1,
      SCRUTIN_COUNT_CHECK: 2,
      SCRUTIN_ATTESTATION: 6,
    });
    expect(counts.rows.OFFICIAL_ORGAN).toBe(0);
    expect(counts.editorial).toEqual({
      placeholderOrganAttestations: 2,
      scrutinsByCountCoherence: { COHERENT: 1, COUNT_MISMATCH: 1, UNVERIFIABLE: 0 },
    });
    expect(validateRecordCounts(counts)).toEqual([]);
    expect(Object.keys(counts.rows)).toEqual([...RECORD_KINDS]);
  });

  it("detects a file that vanished and a scrutin without its coherence row", () => {
    const counts = buildRecordCounts({ files, records: sampleRecords() });
    expect(validateRecordCounts({ ...counts, files: { ...files, accepted: 2 } })).toContain(
      "files: accepted + out of scope + rejected != total"
    );
    expect(
      validateRecordCounts({ ...counts, files: { ...files, rejectedByReason: {} } })
    ).toContain("files: rejected by reason != rejected");
    expect(
      validateRecordCounts({ ...counts, rows: { ...counts.rows, SCRUTIN_COUNT_CHECK: 2 } })
    ).toContain("one coherence row per scrutin is expected");
  });

  it("holds numbers only", () => {
    const counts = buildRecordCounts({ files, records: sampleRecords() });
    expect(JSON.stringify(counts)).not.toMatch(/PA\d|PM\d|PO\d|VTANR/);
  });
});

void civilDate;
