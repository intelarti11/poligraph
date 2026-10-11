import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { COMMUNE_POPULATION_SOURCE } from "@/config/communes";
import { DATA_SOURCE_URLS } from "@/config/labels";
import { TERRITOIRES_PATH } from "@/lib/territoires/paths";
import { sharePercent, type CountShare, type TerritoiresStats } from "@/lib/data/territoires-stats";

const nf = new Intl.NumberFormat("fr-FR");
const pf = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function formatShare(count: number, total: number): string {
  const share = sharePercent(count, total);
  return share === null ? "non calculable" : `${pf.format(share)} %`;
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
}

/** Share bars: every figure is in the text, the bar only repeats it for the eye. */
function ShareList({ rows, unit }: { rows: CountShare[]; unit: string }) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const share = sharePercent(row.count, total) ?? 0;
        const muted = row.key === "inconnu";
        return (
          <li key={row.key}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className={muted ? "text-muted-foreground" : "font-medium"}>{row.label}</span>
              <span className="tabular-nums">
                <strong>{formatShare(row.count, total)}</strong>
                <span className="text-muted-foreground">
                  {" "}
                  ({nf.format(row.count)} {unit})
                </span>
              </span>
            </div>
            <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${muted ? "bg-muted-foreground/40" : "bg-primary/70"}`}
                style={{ width: `${share}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Kpi({ value, label, detail }: { value: string; label: string; detail: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="font-display text-2xl font-extrabold tracking-tight tabular-nums md:text-3xl">
          {value}
        </p>
        <p className="mt-1 text-sm font-medium leading-tight">{label}</p>
        <p className="mt-1 text-xs leading-snug text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

export function TerritoiresSection({ stats }: { stats: TerritoiresStats }) {
  const { maires, communes } = stats;
  const computedOn = formatDate(stats.computedAt);
  const importedOn = formatDate(communes.populationImportedAt);
  const femmes = maires.civility.find((r) => r.key === "femmes")?.count ?? 0;
  const sansMaireEtabli = communes.total - maires.etablis;
  const autresSources = maires.etablis - maires.fromRne;

  return (
    <div className="mt-6 space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Kpi
          value={nf.format(maires.etablis)}
          label="maires en fonction"
          detail={`Communes au maire établi, sur ${nf.format(communes.total)} communes. Calcul du ${computedOn}.`}
        />
        <Kpi
          value={formatShare(femmes, maires.etablis)}
          label="de femmes parmi les maires"
          detail={`${nf.format(femmes)} maires. Civilité inscrite sur la fiche.`}
        />
        <Kpi
          value={maires.medianAge === null ? "Non calculable" : `${maires.medianAge} ans`}
          label="âge médian des maires"
          detail="Parmi les maires dont la date de naissance est connue."
        />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-lg leading-none font-semibold">Parité des maires</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <ShareList rows={maires.civility} unit="maires" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Depuis les municipales de mars 2026, les conseillers municipaux de toutes les communes
            sont élus au scrutin de liste paritaire, avec alternance femme-homme (loi du 21 mai
            2025, y compris sous 1 000 habitants). Cette règle porte sur les listes. Le maire est
            ensuite élu par le conseil municipal, et la part de femmes ci-dessus décrit cette
            fonction, pas la composition des conseils.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-lg leading-none font-semibold">Âge des maires</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <ShareList rows={maires.age} unit="maires" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Âge révolu au {computedOn}, calculé depuis la date de naissance inscrite sur la fiche.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-lg leading-none font-semibold">Communes par taille</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <ShareList rows={communes.population} unit="communes" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {COMMUNE_POPULATION_SOURCE.label}, reçue via{" "}
              <a
                href={COMMUNE_POPULATION_SOURCE.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:no-underline"
              >
                {COMMUNE_POPULATION_SOURCE.via}
              </a>
              {importedOn ? `, importée le ${importedOn}` : ""}. L{"'"}API ne publie pas l{"'"}année
              de référence de ces chiffres.
            </p>
          </CardContent>
        </Card>
      </div>

      <section
        aria-labelledby="territoires-methode"
        className="rounded-lg border bg-muted/40 p-4 text-sm leading-relaxed md:p-5"
      >
        <h2 id="territoires-methode" className="mb-2 font-semibold">
          Méthode et sources
        </h2>
        <p>
          Un maire est compté quand sa commune a exactement un mandat de maire en cours dans nos
          données, hors maires de secteur de Paris, Lyon et Marseille, et que sa fiche est publiée.{" "}
          {nf.format(sansMaireEtabli)} communes n{"'"}entrent dans aucun chiffre : aucun maire en
          cours n{"'"}y est enregistré, ou plusieurs le sont. Sur les {nf.format(maires.etablis)}{" "}
          mandats retenus, {nf.format(maires.fromRne)} proviennent du{" "}
          <a
            href={DATA_SOURCE_URLS.RNE}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:no-underline"
          >
            Répertoire national des élus
          </a>{" "}
          du ministère de l{"'"}Intérieur et {nf.format(autresSources)} d{"'"}autres sources,
          principalement l{"'"}import des candidatures aux municipales 2026.
        </p>
        <p className="mt-2">
          Ces chiffres sont nationaux. Aucun classement entre communes, départements ou régions n
          {"'"}en est tiré. La profession des maires, leur réélection et les présidences de
          département ou de région ne figurent pas ici : nos données ne les couvrent pas encore de
          façon complète.
        </p>
        <p className="mt-3">
          Pour aller plus loin :{" "}
          <Link
            href="/elections/municipales-2026/maires"
            prefetch={false}
            className="underline hover:no-underline"
          >
            annuaire des maires
          </Link>
          ,{" "}
          <Link
            href="/elections/municipales-2026/parite"
            prefetch={false}
            className="underline hover:no-underline"
          >
            parité des candidatures aux municipales 2026
          </Link>
          ,{" "}
          <Link
            href="/elections/municipales-2026/cumul"
            prefetch={false}
            className="underline hover:no-underline"
          >
            cumul des mandats
          </Link>
          ,{" "}
          <Link href={TERRITOIRES_PATH} prefetch={false} className="underline hover:no-underline">
            rubrique Territoires
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
