import { db } from "@/lib/db";
import { INSTITUTION_KIND_LABELS } from "@/config/decisions-territoriales";

// Admin-only reads for the decision forms. Bounded: the pilot covers a dozen communes.
const OPTIONS_LIMIT = 500;

export async function getDecisionFormOptions() {
  const [institutions, sources] = await Promise.all([
    db.institution.findMany({
      orderBy: { name: "asc" },
      take: OPTIONS_LIMIT,
      select: { id: true, name: true, kind: true, communeId: true, sirenEpci: true },
    }),
    db.territorialSource.findMany({
      orderBy: { createdAt: "desc" },
      take: OPTIONS_LIMIT,
      select: { id: true, title: true, producer: true },
    }),
  ]);
  return {
    institutions: institutions.map((i) => ({
      id: i.id,
      label: `${i.name} (${INSTITUTION_KIND_LABELS[i.kind]}, ${i.communeId ?? i.sirenEpci})`,
    })),
    sources: sources.map((s) => ({ id: s.id, label: `${s.title} · ${s.producer}` })),
  };
}

export function isoDay(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}
