import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PoliticianAvatar } from "@/components/politicians/PoliticianAvatar";
import { ensureContrast } from "@/lib/contrast";
import { DepartementSection } from "@/components/territoires/DepartementSection";
import type { getDeputesByDepartment } from "@/lib/data/departments";

type Parlementaire = Awaited<ReturnType<typeof getDeputesByDepartment>>[number];

function ParlementaireRow({
  person,
  fallback,
  withConstituency,
}: {
  person: Parlementaire;
  fallback: string;
  withConstituency: boolean;
}) {
  return (
    <Link
      href={`/politiques/${person.slug}`}
      prefetch={false}
      className="group -mx-2 flex min-h-11 items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted"
    >
      <PoliticianAvatar
        photoUrl={person.photoUrl}
        blobPhotoUrl={person.blobPhotoUrl}
        firstName={person.firstName}
        lastName={person.lastName}
        size="sm"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium transition-colors group-hover:text-primary">{person.fullName}</p>
        <p className="text-xs text-muted-foreground">
          {(withConstituency && person.mandates[0]?.constituency) || fallback}
        </p>
      </div>
      {person.currentParty && (
        <Badge
          variant="secondary"
          className="shrink-0 text-xs"
          title={person.currentParty.name}
          style={{
            backgroundColor: person.currentParty.color
              ? `${person.currentParty.color}15`
              : undefined,
            color: person.currentParty.color
              ? ensureContrast(person.currentParty.color, "#ffffff")
              : undefined,
          }}
        >
          {person.currentParty.shortName}
        </Badge>
      )}
    </Link>
  );
}

function Group({
  title,
  people,
  fallback,
  empty,
}: {
  title: string;
  people: Parlementaire[];
  fallback: string;
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 font-bold">
        <span>{title}</span>
        <Badge variant="outline">{people.length}</Badge>
      </h3>
      {people.length > 0 ? (
        <div className="space-y-1">
          {people.map((p) => (
            <ParlementaireRow
              key={p.id}
              person={p}
              fallback={fallback}
              withConstituency={fallback === "Député"}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

/** The deputies and senators block the department page has always carried. */
export function DepartementParlement({
  deputies,
  senators,
}: {
  deputies: Parlementaire[];
  senators: Parlementaire[];
}) {
  return (
    <DepartementSection id="parlement" title="Au Parlement">
      <Group
        title="Députés"
        people={deputies}
        fallback="Député"
        empty="Aucun député enregistré pour ce département."
      />
      <Group
        title="Sénateurs"
        people={senators}
        fallback="Sénateur"
        empty="Aucun sénateur enregistré pour ce département."
      />
    </DepartementSection>
  );
}
