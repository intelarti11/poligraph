import Link from "next/link";
import type { CurationStatus } from "@/generated/prisma";
import { Card } from "@/components/ui/card";
import { CURATION_STATUS_LABELS } from "@/config/decisions-territoriales";
import { parsePageParam } from "@/lib/data/query-params";
import { db } from "@/lib/db";
import { isoDay } from "./_data";

export const metadata = { title: "Décisions territoriales (admin)", robots: { index: false } };

const PAGE_SIZE = 50;
const STATUSES = Object.keys(CURATION_STATUS_LABELS) as CurationStatus[];

interface PageProps {
  searchParams: Promise<{ status?: string; page?: string }>;
}

export default async function AdminDecisionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const status = STATUSES.includes(params.status as CurationStatus)
    ? (params.status as CurationStatus)
    : undefined;
  const page = parsePageParam(params.page);
  const where = status ? { status } : {};

  const [decisions, total, counts] = await Promise.all([
    db.decision.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        title: true,
        adoptionDate: true,
        status: true,
        commune: { select: { name: true, id: true } },
        institution: { select: { name: true } },
      },
    }),
    db.decision.count({ where }),
    db.decision.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const countOf = (s: CurationStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">
            Décisions territoriales
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Notices des décisions collectives du pilote. Rien n{"'"}est public avant la revue.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link
            href="/admin/territoires/decisions/references"
            className="rounded border px-3 py-2 hover:bg-muted"
          >
            Institutions et sources
          </Link>
          <Link
            href="/admin/territoires/decisions/nouvelle"
            className="rounded border px-3 py-2 hover:bg-muted"
          >
            Nouvelle décision
          </Link>
        </div>
      </header>

      <nav aria-label="Filtrer par état" className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/admin/territoires/decisions"
          prefetch={false}
          className={`rounded border px-3 py-1.5 hover:bg-muted ${!status ? "bg-muted font-medium" : ""}`}
        >
          Toutes
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/territoires/decisions?status=${s}`}
            prefetch={false}
            className={`rounded border px-3 py-1.5 hover:bg-muted ${status === s ? "bg-muted font-medium" : ""}`}
          >
            {CURATION_STATUS_LABELS[s]} ({countOf(s)})
          </Link>
        ))}
      </nav>

      <Card className="p-0">
        {decisions.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Aucune notice dans cet état.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left">
              <tr>
                <th className="p-3">Objet</th>
                <th className="p-3">Commune</th>
                <th className="p-3">Adoption</th>
                <th className="p-3">État</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id} className="border-b last:border-0">
                  <td className="p-3">
                    <Link
                      href={`/admin/territoires/decisions/${d.id}`}
                      prefetch={false}
                      className="underline"
                    >
                      {d.title}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {d.institution.name}
                    </span>
                  </td>
                  <td className="p-3">
                    {d.commune.name} ({d.commune.id})
                  </td>
                  <td className="p-3">{isoDay(d.adoptionDate)}</td>
                  <td className="p-3">{CURATION_STATUS_LABELS[d.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {totalPages > 1 && (
        <p className="text-sm text-muted-foreground">
          Page {page} sur {totalPages}.{" "}
          {page < totalPages && (
            <Link
              href={`/admin/territoires/decisions?${new URLSearchParams({ ...(status && { status }), page: String(page + 1) })}`}
              prefetch={false}
              className="underline"
            >
              Page suivante
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
