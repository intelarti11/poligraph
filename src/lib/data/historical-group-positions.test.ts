import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ queryRaw: vi.fn(), cacheTag: vi.fn(), cacheLife: vi.fn() }));

vi.mock("next/cache", () => ({ cacheTag: mocks.cacheTag, cacheLife: mocks.cacheLife }));
vi.mock("@/lib/db", () => ({ db: { $queryRaw: (...args: unknown[]) => mocks.queryRaw(...args) } }));

import {
  MAX_GROUP_ROWS,
  getHistoricalGroupPositions,
  readHistoricalGroupPositions,
} from "@/lib/data/historical-group-positions";
import { WITHHELD_GROUP_REASON_TEXT } from "@/lib/votes/historical-positions";

const STATUS = {
  legislature: 16,
  countCoherence: "COHERENT",
  groupsShown: 1,
  groupsWithheld: 0,
  withheldGroups: [],
  nonInscritVotes: 0,
  excludedConflictVotes: 0,
  excludedUnknownGroupVotes: 0,
  affiliationsUrl: "https://data.assemblee-nationale.fr/amo.zip",
  affiliationsFetchedAt: new Date("2026-10-18T21:26:12Z"),
  affiliationsAsOf: null,
  scrutinsUrl: "https://data.assemblee-nationale.fr/scrutins.zip",
  scrutinsFetchedAt: new Date("2026-10-18T22:03:56Z"),
};

const ROW = {
  organRef: "PO800490",
  organLabel: "La France insoumise",
  organAbbreviation: "LFI",
  forCount: 21,
  againstCount: 0,
  abstainCount: 0,
  nonVoterCount: 0,
  sameAbbreviationElsewhere: false,
};

/** The first call is the status view, the second the positions view, in that order. */
function answer(status: unknown[], rows: unknown[]) {
  mocks.queryRaw.mockResolvedValueOnce(status).mockResolvedValueOnce(rows);
}

function sqlOf(call: number): string {
  const sql = mocks.queryRaw.mock.calls[call]?.[0] as { strings: string[] };
  return sql.strings.join("?");
}

describe("getHistoricalGroupPositions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lit une seule fois chacune des deux vues publiques, jamais une table brute", async () => {
    answer([STATUS], [ROW]);
    await getHistoricalGroupPositions("VTANR5L16V2978");
    const sql = [sqlOf(0), sqlOf(1)].join("\n");
    expect(sql).toContain('"HistoricalScrutinPublicStatus"');
    expect(sql).toContain('"HistoricalGroupPositionPublic"');
    for (const raw of [
      "ScrutinOrganPosition",
      "RunExclusion",
      "HistoricalResolutionRun",
      "OfficialSourceSnapshot",
      "SnapshotDecision",
      "ScrutinVoterAttestation",
    ]) {
      expect(sql).not.toContain(raw);
    }
  });

  it("paramètre l'identifiant du scrutin et borne le nombre de lignes", async () => {
    answer([STATUS], [ROW]);
    await getHistoricalGroupPositions("VTANR5L16V2978");
    const rowsQuery = mocks.queryRaw.mock.calls[1]?.[0] as { values: unknown[]; strings: string[] };
    expect(rowsQuery.values).toEqual(["VTANR5L16V2978", MAX_GROUP_ROWS]);
    expect(rowsQuery.strings.join("?")).toMatch(/LIMIT \?/);
    // L'identifiant n'est jamais concaténé dans le texte SQL.
    expect(rowsQuery.strings.join("")).not.toContain("VTANR5L16V2978");
  });

  it("rend l'état et les lignes sous leur forme de lecture", async () => {
    answer([STATUS], [ROW]);
    const data = await getHistoricalGroupPositions("VTANR5L16V2978");
    expect(data).toEqual({
      status: STATUS,
      rows: [
        {
          organRef: "PO800490",
          label: "La France insoumise",
          abbreviation: "LFI",
          forCount: 21,
          againstCount: 0,
          abstainCount: 0,
          nonVoterCount: 0,
          sameAbbreviationElsewhere: false,
        },
      ],
    });
  });

  it("aucune ligne en base : état nul, pas une erreur", async () => {
    answer([], []);
    expect(await getHistoricalGroupPositions("VTANR5L16V1")).toEqual({ status: null, rows: [] });
  });

  it.each(["", "../etc/passwd", "VTANR5L16V1; DROP TABLE x", "a".repeat(65), "VT ANR", "é"])(
    "identifiant invalide %j : aucune requête",
    async (id) => {
      expect(await getHistoricalGroupPositions(id)).toEqual({ status: null, rows: [] });
      expect(mocks.queryRaw).not.toHaveBeenCalled();
    }
  );

  it("refuse une ligne malformée plutôt que de la corriger", async () => {
    answer([STATUS], [{ ...ROW, againstCount: -1 }]);
    await expect(getHistoricalGroupPositions("VTANR5L16V1")).rejects.toThrow();
  });

  it("accepte l'état d'un scrutin discordant, sans groupe écarté ni ligne de groupe", async () => {
    // The real shape of the 35 discordant scrutins once the view lists group-level reasons only.
    answer([{ ...STATUS, countCoherence: "COUNT_MISMATCH", groupsShown: 0 }], []);
    const data = await getHistoricalGroupPositions("VTANR5L16V1927");
    expect(data.status?.countCoherence).toBe("COUNT_MISMATCH");
  });

  it("refuse une raison qui n'est pas au niveau du groupe (le SQL ne doit plus la produire)", async () => {
    answer(
      [
        {
          ...STATUS,
          withheldGroups: [{ label: "X", abbreviation: null, reason: "COUNT_MISMATCH" }],
        },
      ],
      []
    );
    await expect(getHistoricalGroupPositions("VTANR5L16V1927")).rejects.toThrow();
  });

  it("la liste de raisons du SQL est exactement celle que le lecteur accepte et que la page explique", async () => {
    // The integration suite is not run in CI: this keeps the three places in step. Before the
    // fix, the view listed COUNT_MISMATCH here and every discordant scrutin was refused.
    const sql = readFileSync(
      "prisma/migrations/manual/2026-10-21-historical-groups-public-read.sql",
      "utf8"
    );
    const list = sql.match(/COALESCE\(b\."reason", 'UNLABELLED_GROUP'\) IN\s*\(([^)]*)\)/);
    expect(list, "allowlist of reasons not found in the SQL").not.toBeNull();
    const inSql = [...(list?.[1] ?? "").matchAll(/'([A-Z_]+)'/g)].flatMap((m) =>
      m[1] ? [m[1]] : []
    );
    expect([...inSql].sort()).toEqual(Object.keys(WITHHELD_GROUP_REASON_TEXT).sort());
    for (const reason of inSql) {
      answer([{ ...STATUS, withheldGroups: [{ label: "X", abbreviation: null, reason }] }], []);
      await expect(getHistoricalGroupPositions("VTANR5L16V1")).resolves.toBeDefined();
    }
  });

  it("refuse un état inconnu de la cohérence des totaux", async () => {
    answer([{ ...STATUS, countCoherence: "SOMETHING_NEW" }], []);
    await expect(getHistoricalGroupPositions("VTANR5L16V1")).rejects.toThrow();
  });

  it.each([
    "javascript:alert(1)",
    "http://data.assemblee-nationale.fr/scrutins.zip",
    "https://evil.example/scrutins.zip",
    "https://data.assemblee-nationale.fr.evil.example/x",
    "not a url",
  ])("refuse le lien de source %j", async (url) => {
    for (const field of ["scrutinsUrl", "affiliationsUrl"]) {
      answer([{ ...STATUS, [field]: url }], []);
      await expect(getHistoricalGroupPositions("VTANR5L16V1")).rejects.toThrow();
    }
  });

  it("étiquette le cache sur les votes, sur l'étiquette étroite, et le profil synchronisé", async () => {
    answer([STATUS], [ROW]);
    await getHistoricalGroupPositions("VTANR5L16V2978");
    expect(mocks.cacheTag).toHaveBeenCalledWith("votes", "historical-group-positions");
    expect(mocks.cacheLife).toHaveBeenCalledWith("synced");
  });
});

describe("readHistoricalGroupPositions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("une lecture en échec devient un état explicite, jamais une valeur plausible", async () => {
    mocks.queryRaw.mockRejectedValue(
      new Error('relation "HistoricalScrutinPublicStatus" does not exist')
    );
    expect(await readHistoricalGroupPositions("VTANR5L16V1")).toEqual({ unreadable: true });
  });

  it("une réponse malformée devient aussi un échec de lecture", async () => {
    answer([STATUS], [{ ...ROW, forCount: "21" }]);
    expect(await readHistoricalGroupPositions("VTANR5L16V1")).toEqual({ unreadable: true });
  });

  it("rend les données quand tout va bien", async () => {
    answer([STATUS], [ROW]);
    const data = await readHistoricalGroupPositions("VTANR5L16V2978");
    expect(data).toMatchObject({ status: { legislature: 16 }, rows: [{ organRef: "PO800490" }] });
  });
});
