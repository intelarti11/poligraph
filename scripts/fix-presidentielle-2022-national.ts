/**
 * Corrects the national results of presidentielle-2022 from the Conseil constitutionnel
 * proclamations (see src/services/sync/presidentielle-2022-national.ts for the decisions).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/fix-presidentielle-2022-national.ts --dry-run
 *   npx tsx --env-file=.env scripts/fix-presidentielle-2022-national.ts
 *
 * Touches published data: the dry run prints every field before and after. Writes, in one
 * transaction: the two ElectionRound statistics, votes/shares/qualification/election of the
 * twelve candidacies, the two missing candidacies, and the removal of any link to a fiche that
 * does not carry the candidate's Wikidata item. Purges no cache.
 */

import "dotenv/config";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import {
  CANDIDATES_2022,
  CC_ROUND1_URL,
  CC_ROUND2_URL,
  ROUND_TOTALS_2022,
  decideLink,
  findExisting,
  participationPct,
  targetFields,
  type LinkDecision,
} from "@/services/sync/presidentielle-2022-national";

const SLUG = "presidentielle-2022";
const DRY_RUN = process.argv.includes("--dry-run");

type Value = string | number | boolean | null;

function show(v: Value): string {
  return v === null ? "null" : String(v);
}

function diffLine(field: string, before: Value, after: Value): string {
  return before === after
    ? `    ${field}: ${show(before)} (inchangé)`
    : `    ${field}: ${show(before)} -> ${show(after)}`;
}

function num(d: Prisma.Decimal | null): number | null {
  return d == null ? null : Number(d);
}

async function main() {
  const election = await db.election.findUnique({
    where: { slug: SLUG },
    select: { id: true, rounds: { orderBy: { round: "asc" } } },
  });
  if (!election) throw new Error(`Élection ${SLUG} introuvable`);

  const candidacies = await db.candidacy.findMany({
    where: { electionId: election.id },
    select: {
      id: true,
      candidateName: true,
      politicianId: true,
      round1Votes: true,
      round1Pct: true,
      round1Qualified: true,
      round2Votes: true,
      round2Pct: true,
      isElected: true,
      politician: {
        select: {
          slug: true,
          externalIds: { where: { source: "WIKIDATA" }, select: { externalId: true } },
        },
      },
    },
    take: 100,
  });

  console.log(`${SLUG}${DRY_RUN ? " (DRY RUN, aucune écriture)" : ""}`);
  console.log(`Sources : ${CC_ROUND1_URL} ; ${CC_ROUND2_URL}`);
  console.log(`Candidatures en base : ${candidacies.length}\n`);

  const roundUpdates: Array<{ id: string; data: Prisma.ElectionRoundUpdateInput }> = [];
  for (const round of [1, 2] as const) {
    const row = election.rounds.find((r) => r.round === round);
    if (!row) throw new Error(`ElectionRound ${round} absent`);
    const t = ROUND_TOTALS_2022[round];
    const participation = participationPct(t);
    console.log(`ElectionRound tour ${round}`);
    console.log(diffLine("registeredVoters", row.registeredVoters, t.registeredVoters));
    console.log(diffLine("actualVoters", row.actualVoters, t.actualVoters));
    console.log(diffLine("participationRate", num(row.participationRate), participation));
    console.log(diffLine("blankVotes", row.blankVotes, t.blankVotes));
    console.log(diffLine("nullVotes", row.nullVotes, t.nullVotes));
    roundUpdates.push({
      id: row.id,
      data: {
        registeredVoters: t.registeredVoters,
        actualVoters: t.actualVoters,
        participationRate: new Prisma.Decimal(participation),
        blankVotes: t.blankVotes,
        nullVotes: t.nullVotes,
      },
    });
  }

  const writes: Array<() => Prisma.PrismaPromise<unknown>> = [];
  for (const candidate of CANDIDATES_2022) {
    const existing = findExisting(candidate, candidacies);
    const target = targetFields(candidate);

    let decision: LinkDecision;
    if (existing) {
      decision = decideLink(
        candidate,
        {
          id: existing.id,
          candidateName: existing.candidateName,
          politicianId: existing.politicianId,
          politicianWikidataIds: existing.politician?.externalIds.map((e) => e.externalId) ?? [],
        },
        []
      );
    } else {
      const fiches = await db.politician.findMany({
        where: { fullName: candidate.candidateName },
        select: {
          id: true,
          externalIds: { where: { source: "WIKIDATA" }, select: { externalId: true } },
        },
        take: 10,
      });
      decision = decideLink(
        candidate,
        null,
        fiches.map((f) => ({ id: f.id, wikidataIds: f.externalIds.map((e) => e.externalId) }))
      );
    }

    console.log(
      `\n${candidate.candidateName} : ${existing ? `mise à jour (${existing.id})` : "CRÉATION"}`
    );
    console.log(diffLine("round1Votes", existing?.round1Votes ?? null, target.round1Votes));
    console.log(diffLine("round1Pct", num(existing?.round1Pct ?? null), target.round1Pct));
    console.log(
      diffLine("round1Qualified", existing?.round1Qualified ?? null, target.round1Qualified)
    );
    console.log(diffLine("round2Votes", existing?.round2Votes ?? null, target.round2Votes));
    console.log(diffLine("round2Pct", num(existing?.round2Pct ?? null), target.round2Pct));
    console.log(diffLine("isElected", existing?.isElected ?? null, target.isElected));
    const linkedSlug = existing?.politician?.slug ?? null;
    if (decision.action === "keep") console.log(`    fiche: ${linkedSlug} (conservée)`);
    if (decision.action === "unlink") {
      console.log(`    fiche: ${linkedSlug} -> null (RETIRÉE : ${decision.reason})`);
    }
    if (decision.action === "link") console.log(`    fiche: null -> ${decision.politicianId}`);
    if (decision.action === "none") console.log(`    fiche: aucune (${decision.reason})`);

    const data = {
      ...target,
      round1Pct: new Prisma.Decimal(target.round1Pct),
      round2Pct: target.round2Pct != null ? new Prisma.Decimal(target.round2Pct) : null,
    };
    if (existing) {
      writes.push(() =>
        db.candidacy.update({
          where: { id: existing.id },
          data: { ...data, ...(decision.action === "unlink" && { politicianId: null }) },
        })
      );
    } else {
      const party = candidate.partySlug
        ? await db.party.findUnique({ where: { slug: candidate.partySlug }, select: { id: true } })
        : null;
      console.log(
        `    partyLabel: ${candidate.partyLabel}, parti: ${party ? candidate.partySlug : "aucun"}`
      );
      writes.push(() =>
        db.candidacy.create({
          data: {
            ...data,
            electionId: election.id,
            candidateName: candidate.candidateName,
            partyLabel: candidate.partyLabel,
            partyId: party?.id ?? null,
            status: "DECLARE",
            politicianId: decision.action === "link" ? decision.politicianId : null,
          },
        })
      );
    }
  }

  const unknown = candidacies.filter(
    (c) => !CANDIDATES_2022.some((k) => findExisting(k, [c]) !== null)
  );
  if (unknown.length > 0) {
    throw new Error(`Candidatures inattendues en base : ${unknown.map((c) => c.candidateName)}`);
  }

  if (DRY_RUN) {
    console.log("\nDry run : rien n'a été écrit.");
    return;
  }
  await db.$transaction([
    ...roundUpdates.map((r) => db.electionRound.update({ where: { id: r.id }, data: r.data })),
    ...writes.map((w) => w()),
  ]);
  console.log(`\nÉcrit : 2 tours, ${writes.length} candidatures.`);
}

main()
  .catch((err) => {
    console.error("Erreur :", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
