/**
 * Read boundary of the historical group counts (lot 6).
 *
 * The raw tables of the lot 5 (runs, positions, exclusions, attestations, snapshots, decisions)
 * are closed to the site. The application reads two public views, through ONE module, and the SQL
 * of those views grants nothing to anyone but the owner. Each rule below is falsifiable: the
 * scanner is also run on snippets that must be refused.
 *
 * The scan reads emitted code with comments removed, so a table named in prose never trips it and
 * never hides a real use.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { HISTORICAL_GROUP_POSITIONS_PUBLIC } from "@/config/historical-positions";

const ROOT = process.cwd();

const RAW_TABLES = [
  "SourceArtifact",
  "OfficialSourceSnapshot",
  "SnapshotDecision",
  "OfficialActor",
  "OfficialOrganRecord",
  "GroupMembershipRecord",
  "SeatMandateRecord",
  "ScrutinVoterAttestation",
  "ScrutinCountCheck",
  "ScrutinGroupCountCheck",
  "OfficialActorLinkDecision",
  "OrganContinuityDecision",
  "HistoricalResolutionRun",
  "HistoricalRunSnapshotPin",
  "RunExclusion",
  "ScrutinOrganPosition",
];

const PUBLIC_VIEWS = [
  "HistoricalGroupPositionPublic",
  "HistoricalScrutinPublicStatus",
  "HistoricalPublishedRun",
];

const READER = "src/lib/data/historical-group-positions.ts";

/** Where public code lives. The lot 5 module and the scripts are deliberately outside. */
const PUBLIC_SURFACE = [
  "src/app",
  "src/components",
  "src/lib/data",
  "src/lib/votes",
  "src/lib/api",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const isTest = (file: string) =>
  /(\.test\.|\.stories\.|\.integration\.)/.test(file) || file.includes("/__tests__/");

/** Emitted code without comments. Strings are kept: a table name inside an SQL string counts. */
function code(source: string): string {
  return ts.transpileModule(source, {
    compilerOptions: {
      removeComments: true,
      target: ts.ScriptTarget.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
  }).outputText;
}

/** Cheap text prefilter first: only a file that contains a name at all is transpiled. */
function mentions(source: string, names: string[]): string[] {
  const candidates = names.filter((name) => source.includes(name));
  if (candidates.length === 0) return [];
  const emitted = code(source);
  return candidates.filter((name) => new RegExp(`\\b${name}\\b`).test(emitted));
}

const publicFiles = PUBLIC_SURFACE.flatMap((dir) => walk(join(ROOT, dir)))
  .filter((file) => !isTest(file))
  .map((file) => relative(ROOT, file));

describe("scanner (a guard that cannot fail proves nothing)", () => {
  it("voit une table brute dans une chaîne SQL, pas dans un commentaire", () => {
    expect(mentions('db.$queryRaw`SELECT 1 FROM "ScrutinOrganPosition"`', RAW_TABLES)).toEqual([
      "ScrutinOrganPosition",
    ]);
    expect(
      mentions("// ScrutinOrganPosition\n/* RunExclusion */ const a = 1;", RAW_TABLES)
    ).toEqual([]);
  });
});

describe("frontière de lecture des positions historiques", () => {
  it("lit au moins les fichiers publics attendus", () => {
    expect(publicFiles).toContain(READER);
    expect(publicFiles.length).toBeGreaterThan(100);
  });

  it("aucun code public ne nomme une table brute du lot 5", () => {
    const offenders = publicFiles
      .map((file) => [file, mentions(readFileSync(join(ROOT, file), "utf8"), RAW_TABLES)] as const)
      .filter(([, names]) => names.length > 0);
    expect(offenders).toEqual([]);
  });

  it("un seul module nomme les vues publiques", () => {
    const allSource = walk(join(ROOT, "src"))
      .filter((file) => !isTest(file))
      .map((file) => relative(ROOT, file));
    const readers = allSource.filter(
      (file) => mentions(readFileSync(join(ROOT, file), "utf8"), PUBLIC_VIEWS).length > 0
    );
    expect(readers).toEqual([READER]);
  });

  it("le lecteur ne fait que lire : pas d'écriture, pas de SELECT *, pas de SQL concaténé", () => {
    const emitted = code(readFileSync(join(ROOT, READER), "utf8"));
    expect(emitted).not.toMatch(/\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe/);
    expect(emitted).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/);
    expect(emitted).not.toMatch(/SELECT\s+\*/i);
    expect(emitted).toMatch(/\$queryRaw/);
    expect(emitted).toMatch(/Prisma\.sql/);
  });

  it("l'activation publique est une décision éditoriale distincte, éteinte dans cette PR", () => {
    // Pour activer : décider avec la liste de docs/audits/parlement-historique-lot6-consultation.md,
    // passer la constante à true et mettre cette attente à jour dans le même changement.
    expect(HISTORICAL_GROUP_POSITIONS_PUBLIC).toBe(false);
  });
});

describe("SQL de la couche de lecture", () => {
  const sql = readFileSync(
    join(ROOT, "prisma/migrations/manual/2026-10-21-historical-groups-public-read.sql"),
    "utf8"
  );
  const rollback = readFileSync(
    join(ROOT, "prisma/migrations/manual/2026-10-21-historical-groups-public-read-rollback.sql"),
    "utf8"
  );
  const statements = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

  it("ne crée que des vues, et ne touche à aucune table existante", () => {
    expect(statements).not.toMatch(/\bCREATE\s+TABLE\b/i);
    expect(statements).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(statements).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    const created = [...statements.matchAll(/CREATE\s+VIEW\s+"(\w+)"/gi)].map((m) => m[1]);
    expect(created.sort()).toEqual([...PUBLIC_VIEWS].sort());
  });

  it("n'accorde aucun droit et retire ceux de PUBLIC, anon et authenticated", () => {
    expect(statements).not.toMatch(/\bGRANT\b/i);
    const revoke = statements.match(/REVOKE ALL ON TABLE ([^;]+) FROM ([^;]+);/i);
    expect(revoke).not.toBeNull();
    for (const view of PUBLIC_VIEWS) expect(revoke?.[1]).toContain(`"${view}"`);
    for (const role of ["PUBLIC", "anon", "authenticated"]) expect(revoke?.[2]).toContain(role);
  });

  it("les deux vues lues par le site n'exposent ni empreinte, ni identifiant, ni preuve", () => {
    const exposed = (name: string) => {
      const start = statements.indexOf(`CREATE VIEW "${name}"`);
      const next = statements.indexOf("CREATE VIEW", start + 10);
      const end = next === -1 ? statements.indexOf("REVOKE", start) : next;
      return statements.slice(start, end);
    };
    for (const name of ["HistoricalGroupPositionPublic", "HistoricalScrutinPublicStatus"]) {
      const body = exposed(name);
      // Output columns only: names after AS, or a bare selected column of the final SELECT.
      for (const forbidden of [
        "memberHash",
        "rawHash",
        "stateHash",
        "officialId",
        "evidence",
        "decidedBy",
        "inputHash",
        "outputHash",
        "decisionsHash",
        "runId",
      ]) {
        expect(body, `${name} must not expose ${forbidden}`).not.toContain(`AS "${forbidden}"`);
      }
      expect(body).toContain("security_barrier = true");
    }
  });

  it("le retour arrière retire exactement les trois vues", () => {
    const dropped = [...rollback.matchAll(/DROP VIEW IF EXISTS "(\w+)"/g)].map((m) => m[1]);
    expect(dropped.sort()).toEqual([...PUBLIC_VIEWS].sort());
    expect(rollback).not.toMatch(/\bDROP\s+TABLE\b/i);
  });

  it("s'arrête de lui-même si un droit subsiste ou si la RLS d'une table brute est coupée", () => {
    expect(statements).toContain("::int");
    expect(statements).not.toMatch(/\bDO\s+\$/);
    expect(statements).toContain("relrowsecurity");
  });
});
