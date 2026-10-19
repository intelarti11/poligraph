import { describe, expect, it } from "vitest";
import {
  WITHHELD_GROUP_REASON_TEXT,
  buildHistoricalPositionsView,
  planGroupsSection,
  type HistoricalGroupRow,
  type HistoricalPositionsData,
  type HistoricalScrutinStatus,
} from "@/lib/votes/historical-positions";

function row(overrides: Partial<HistoricalGroupRow> = {}): HistoricalGroupRow {
  return {
    organRef: "PO800490",
    label: "La France insoumise - Nouvelle Union Populaire écologique et sociale",
    abbreviation: "LFI - NUPES",
    forCount: 21,
    againstCount: 0,
    abstainCount: 0,
    nonVoterCount: 0,
    sameAbbreviationElsewhere: false,
    ...overrides,
  };
}

function status(overrides: Partial<HistoricalScrutinStatus> = {}): HistoricalScrutinStatus {
  return {
    legislature: 16,
    countCoherence: "COHERENT",
    groupsShown: 1,
    groupsWithheld: 0,
    withheldGroups: [],
    nonInscritVotes: 0,
    excludedConflictVotes: 0,
    excludedUnknownGroupVotes: 0,
    affiliationsUrl: "https://data.assemblee-nationale.fr/amo.json.zip",
    affiliationsFetchedAt: new Date("2026-10-18T21:26:12Z"),
    affiliationsAsOf: new Date("2026-10-17T00:34:00Z"),
    scrutinsUrl: "https://data.assemblee-nationale.fr/scrutins.json.zip",
    scrutinsFetchedAt: new Date("2026-10-18T22:03:56Z"),
    ...overrides,
  };
}

const ok = (rows = [row()], s = status()): HistoricalPositionsData => ({ status: s, rows });

describe("buildHistoricalPositionsView : états", () => {
  it("présente les groupes quand tout est recoupé", () => {
    const view = buildHistoricalPositionsView({ legislature: 16, data: ok() });
    expect(view.kind).toBe("positions");
    if (view.kind !== "positions") return;
    expect(view.completeness).toBe("complete");
    expect(view.rows).toHaveLength(1);
    expect(view.notices).toEqual([]);
  });

  it("scrutin aux décomptes discordants : rien n'est présenté, même si des lignes arrivent", () => {
    const view = buildHistoricalPositionsView({
      legislature: 16,
      data: ok([row()], status({ countCoherence: "COUNT_MISMATCH" })),
    });
    expect(view).toMatchObject({ kind: "withheld", cause: "count-discordant" });
    // La garde ne laisse passer aucune ligne : le type de la vue n'en porte pas.
    expect(JSON.stringify(view)).not.toContain("PO800490");
  });

  it.each(["UNVERIFIABLE", "COUNT_COHERENCE_UNKNOWN"] as const)(
    "totaux non vérifiables (%s) : jamais présenté",
    (countCoherence) => {
      const view = buildHistoricalPositionsView({
        legislature: 17,
        data: ok([row()], status({ legislature: 17, countCoherence })),
      });
      expect(view).toMatchObject({ kind: "withheld", cause: "count-unverifiable" });
    }
  );

  it("aucune ligne en base pour le scrutin : historique indisponible, pas une absence de vote", () => {
    const view = buildHistoricalPositionsView({
      legislature: 16,
      data: { status: null, rows: [] },
    });
    expect(view).toEqual({ kind: "unavailable", legislature: 16, cause: "no-published-run" });
  });

  it("législature hors périmètre : jamais de repli vers l'affiliation actuelle", () => {
    for (const legislature of [14, 18, 2023]) {
      expect(buildHistoricalPositionsView({ legislature, data: ok() })).toEqual({
        kind: "unavailable",
        legislature,
        cause: "legislature-not-covered",
      });
    }
  });

  it("lecture en échec : état explicite, pas de valeur plausible", () => {
    expect(buildHistoricalPositionsView({ legislature: 16, data: { unreadable: true } })).toEqual({
      kind: "unavailable",
      legislature: 16,
      cause: "read-error",
    });
  });

  it("incohérence entre l'état annoncé et les lignes reçues : indisponible", () => {
    const view = buildHistoricalPositionsView({
      legislature: 16,
      data: ok([row()], status({ groupsShown: 2 })),
    });
    expect(view).toMatchObject({ kind: "unavailable", cause: "read-error" });
  });

  it("une ligne d'une autre législature que celle de la page est refusée", () => {
    const view = buildHistoricalPositionsView({
      legislature: 16,
      data: ok([row()], status({ legislature: 17 })),
    });
    expect(view).toMatchObject({ kind: "unavailable", cause: "read-error" });
  });

  it.each([
    ["négatif", -1],
    ["fractionnaire", 1.5],
    ["NaN", Number.NaN],
  ])("décompte %s : indisponible", (_label, value) => {
    const view = buildHistoricalPositionsView({
      legislature: 16,
      data: ok([row({ againstCount: value })]),
    });
    expect(view).toMatchObject({ kind: "unavailable", cause: "read-error" });
  });

  it("totaux recoupés mais aucun groupe présentable : l'état le dit et garde les raisons", () => {
    const withheld = [
      {
        label: "Démocrate (MoDem et Indépendants)",
        abbreviation: "Dem",
        reason: "EXCLUDED_VOTES_PRESENT" as const,
      },
    ];
    const view = buildHistoricalPositionsView({
      legislature: 16,
      data: {
        status: status({ groupsShown: 0, groupsWithheld: 1, withheldGroups: withheld }),
        rows: [],
      },
    });
    expect(view).toMatchObject({
      kind: "withheld",
      cause: "no-group-presentable",
      withheldGroups: withheld,
    });
  });
});

describe("buildHistoricalPositionsView : limites explicitées", () => {
  it("vote exclu pour conflit entre sources : mention, et présentation partielle", () => {
    const view = buildHistoricalPositionsView({
      legislature: 16,
      data: ok(
        [row()],
        status({
          groupsWithheld: 1,
          excludedConflictVotes: 2,
          withheldGroups: [
            { label: "Renaissance", abbreviation: "RE", reason: "EXCLUDED_VOTES_PRESENT" },
          ],
        })
      ),
    });
    expect(view.kind).toBe("positions");
    if (view.kind !== "positions") return;
    expect(view.completeness).toBe("partial");
    const text = view.notices.map((n) => n.text).join(" ");
    expect(text).toContain("2 votes ne sont comptés dans aucun groupe");
    expect(text).toContain("donnent un groupe différent");
  });

  it("accorde au singulier", () => {
    const view = buildHistoricalPositionsView({
      legislature: 16,
      data: ok([row()], status({ excludedConflictVotes: 1, nonInscritVotes: 1 })),
    });
    if (view.kind !== "positions") throw new Error("positions attendues");
    const text = view.notices.map((n) => n.text);
    expect(text.some((t) => t.startsWith("1 vote n'est compté dans aucun groupe"))).toBe(true);
    expect(
      text.some((t) => t.includes("1 vote de députés non inscrits ne figure dans aucune ligne"))
    ).toBe(true);
    expect(text.some((t) => t.includes("pour ce député à cette date"))).toBe(true);
  });

  it("accorde au pluriel : plusieurs votes écartés pour conflit, plusieurs députés", () => {
    const view = buildHistoricalPositionsView({
      legislature: 16,
      data: ok([row()], status({ excludedConflictVotes: 3 })),
    });
    if (view.kind !== "positions") throw new Error("positions attendues");
    const text = view.notices.map((n) => n.text).join(" ");
    expect(text).toContain("3 votes ne sont comptés dans aucun groupe");
    expect(text).toContain("pour ces députés à cette date");
  });

  it("non-inscrits : dit que ce n'est pas un groupe", () => {
    const view = buildHistoricalPositionsView({
      legislature: 16,
      data: ok([row()], status({ nonInscritVotes: 12 })),
    });
    if (view.kind !== "positions") throw new Error("positions attendues");
    expect(view.notices.map((n) => n.text).join(" ")).toContain("ne forment pas un groupe");
    // Les non-inscrits n'ajoutent pas d'exclusion : la présentation reste complète.
    expect(view.completeness).toBe("complete");
  });

  it("groupe sans vote attesté : présenté comme non présenté, avec sa raison", () => {
    const view = buildHistoricalPositionsView({
      legislature: 16,
      data: ok(
        [row()],
        status({
          groupsWithheld: 1,
          withheldGroups: [
            { label: "Renaissance", abbreviation: "RE", reason: "NO_ATTESTED_VOTE" },
          ],
        })
      ),
    });
    if (view.kind !== "positions") throw new Error("positions attendues");
    expect(view.completeness).toBe("partial");
    expect(WITHHELD_GROUP_REASON_TEXT.NO_ATTESTED_VOTE).toContain("aucun vote pour");
  });

  it("groupes renommés : même sigle sous deux références, jamais fusionnés", () => {
    const rows = [
      row({
        organRef: "PO1",
        label: "Socialistes et apparentés",
        abbreviation: "SOC",
        sameAbbreviationElsewhere: true,
      }),
      row({
        organRef: "PO2",
        label: "Socialistes et apparentés (ancien)",
        abbreviation: "SOC",
        sameAbbreviationElsewhere: true,
      }),
    ];
    const view = buildHistoricalPositionsView({
      legislature: 16,
      data: ok(rows, status({ groupsShown: 2 })),
    });
    if (view.kind !== "positions") throw new Error("positions attendues");
    expect(view.rows).toHaveLength(2);
    const notice = view.notices.find((n) => n.kind === "renamed-groups");
    expect(notice?.text).toContain("SOC");
    expect(notice?.text).toContain("ne les relie pas");
  });

  it("un sigle renommé seul sur la page ne déclenche aucun avis", () => {
    // Regression: the flag is true for every row of an abbreviation renamed during the
    // legislature, so the notice used to appear on most pages without naming anything visible.
    const view = buildHistoricalPositionsView({
      legislature: 16,
      data: ok(
        [
          row({
            organRef: "PO1",
            label: "Socialistes et apparentés",
            abbreviation: "SOC",
            sameAbbreviationElsewhere: true,
          }),
        ],
        status({ groupsShown: 1 })
      ),
    });
    if (view.kind !== "positions") throw new Error("positions attendues");
    expect(view.notices.find((n) => n.kind === "renamed-groups")).toBeUndefined();
  });

  it("un groupe écarté qui partage le sigle d'une ligne affichée déclenche l'avis", () => {
    const view = buildHistoricalPositionsView({
      legislature: 16,
      data: ok(
        [
          row({
            organRef: "PO1",
            label: "Socialistes et apparentés",
            abbreviation: "SOC",
            sameAbbreviationElsewhere: true,
          }),
        ],
        status({
          groupsShown: 1,
          groupsWithheld: 1,
          withheldGroups: [
            {
              label: "Socialistes (autre référence)",
              abbreviation: "SOC",
              reason: "NO_ATTESTED_VOTE",
            },
          ],
        })
      ),
    });
    if (view.kind !== "positions") throw new Error("positions attendues");
    expect(view.notices.find((n) => n.kind === "renamed-groups")?.text).toContain("SOC");
  });

  it("n'invente aucune position majoritaire", () => {
    const view = buildHistoricalPositionsView({ legislature: 16, data: ok() });
    expect(JSON.stringify(view).toLowerCase()).not.toContain("majorit");
  });
});

describe("textes publics", () => {
  it("sans tiret long ni accent omis", () => {
    const view = buildHistoricalPositionsView({
      legislature: 16,
      data: ok(
        [row()],
        status({
          nonInscritVotes: 3,
          excludedConflictVotes: 2,
          excludedUnknownGroupVotes: 1,
          groupsWithheld: 1,
          withheldGroups: [
            { label: "Renaissance", abbreviation: "RE", reason: "EXCLUDED_VOTES_PRESENT" },
          ],
        })
      ),
    });
    if (view.kind !== "positions") throw new Error("positions attendues");
    const all = [
      ...view.notices.map((n) => n.text),
      ...Object.values(WITHHELD_GROUP_REASON_TEXT),
    ].join("\n");
    expect(all).not.toMatch(/[–—]/);
    for (const wrong of ["egalement", "elus", "criteres", "deputes", "Assemblee", "regroupes"]) {
      expect(all).not.toContain(wrong);
    }
  });
});

describe("planGroupsSection", () => {
  const positions = buildHistoricalPositionsView({ legislature: 16, data: ok() });
  const withheld = buildHistoricalPositionsView({
    legislature: 16,
    data: ok([row()], status({ countCoherence: "COUNT_MISMATCH" })),
  });
  const unavailable = buildHistoricalPositionsView({
    legislature: 16,
    data: { status: null, rows: [] },
  });
  const base = { enabled: true, chamber: "AN", officialGroupsShown: false } as const;

  it("interrupteur éteint : l'ancien comportement, tel quel", () => {
    for (const hasComputedPositions of [true, false]) {
      for (const officialGroupsShown of [true, false]) {
        expect(
          planGroupsSection({
            ...base,
            enabled: false,
            officialGroupsShown,
            view: positions,
            hasComputedPositions,
          })
        ).toEqual({
          showHistorical: false,
          showCurrentAffiliationPositions: hasComputedPositions,
          dropsLegacyNotice: false,
        });
      }
    }
  });

  it("Sénat : jamais de bloc historique", () => {
    expect(
      planGroupsSection({ ...base, chamber: "SENAT", view: positions, hasComputedPositions: true })
    ).toEqual({
      showHistorical: false,
      showCurrentAffiliationPositions: true,
      dropsLegacyNotice: false,
    });
  });

  it("décompte officiel affiché : ni tableau daté, ni ancien bloc, ni ancienne mention", () => {
    // Even when a dated view exists, so a stale value can never put two tables on the page.
    for (const view of [positions, withheld, unavailable, null]) {
      expect(
        planGroupsSection({ ...base, officialGroupsShown: true, view, hasComputedPositions: true })
      ).toEqual({
        showHistorical: false,
        showCurrentAffiliationPositions: false,
        dropsLegacyNotice: true,
      });
    }
  });

  it("décompte officiel absent, décompte daté présenté ou retenu : l'ancien bloc disparaît", () => {
    for (const view of [positions, withheld]) {
      expect(planGroupsSection({ ...base, view, hasComputedPositions: true })).toEqual({
        showHistorical: true,
        showCurrentAffiliationPositions: false,
        dropsLegacyNotice: true,
      });
    }
  });

  it("décompte officiel absent et historique indisponible : l'ancien bloc reste, avec sa mise en garde", () => {
    expect(planGroupsSection({ ...base, view: unavailable, hasComputedPositions: true })).toEqual({
      showHistorical: true,
      showCurrentAffiliationPositions: true,
      dropsLegacyNotice: true,
    });
  });

  it("décompte daté pas lu : on garde l'ancien comportement", () => {
    expect(planGroupsSection({ ...base, view: null, hasComputedPositions: true })).toEqual({
      showHistorical: false,
      showCurrentAffiliationPositions: true,
      dropsLegacyNotice: false,
    });
  });
});
