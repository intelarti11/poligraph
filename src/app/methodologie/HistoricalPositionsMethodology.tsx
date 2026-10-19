import Link from "next/link";

export const HISTORICAL_POSITIONS_SECTION_ID = "votes-historiques-des-groupes";

const CASES: { title: string; text: string }[] = [
  {
    title: "Totaux qui ne concordent pas",
    text: "Quand la somme des votes individuels diffère du résultat publié par l'Assemblée pour ce scrutin, aucun tableau n'est affiché. Les deux séries ne peuvent pas être juste en même temps, et PoliGraph ne tranche pas.",
  },
  {
    title: "Totaux impossibles à comparer",
    text: "Si le résultat officiel du scrutin n'est pas exploitable, le contrôle n'a pas lieu et rien n'est affiché non plus. Le message le distingue du cas précédent.",
  },
  {
    title: "Vote qui ne peut pas être rattaché",
    text: "Si deux sources se contredisent sur le groupe d'un député ce jour-là, son vote n'est compté dans aucun groupe. Le groupe concerné n'est pas présenté, et le nombre de votes laissés de côté est indiqué.",
  },
  {
    title: "Groupe sans vote attesté",
    text: "Un groupe dont aucun membre n'a un vote pour, contre ou abstention publié figure dans la liste des groupes non présentés, avec cette raison.",
  },
  {
    title: "Non-inscrits",
    text: "Les députés non inscrits ne forment pas un groupe. Leurs votes ne sont pas additionnés et le tableau le mentionne.",
  },
  {
    title: "Groupes renommés",
    text: "Quand deux références de l'Assemblée portent le même sigle dans une législature (un groupe renommé en cours de route, par exemple), chacune a sa ligne. PoliGraph n'affirme pas qu'il s'agit du même groupe.",
  },
  {
    title: "Pas de données",
    text: "Pour une législature non couverte, ou un scrutin sans données contrôlées, le bloc le dit. Ce n'est pas une absence de vote.",
  },
];

/**
 * Methodology of the dated group counts on the scrutin page. Rendered by the methodology page only
 * while HISTORICAL_GROUP_POSITIONS_PUBLIC is on, so the page never describes a block the site does
 * not show.
 */
export function HistoricalPositionsMethodology() {
  return (
    <section
      id={HISTORICAL_POSITIONS_SECTION_ID}
      aria-labelledby={`${HISTORICAL_POSITIONS_SECTION_ID}-title`}
      className="mb-12"
    >
      <h2
        id={`${HISTORICAL_POSITIONS_SECTION_ID}-title`}
        className="text-2xl font-display font-bold mb-4"
      >
        Votes des groupes à la date du scrutin
      </h2>
      <p className="text-muted-foreground mb-4">
        Sur la page d{"'"}un scrutin public de l{"'"}Assemblée nationale, PoliGraph additionne les
        votes de chaque député selon le groupe auquel il appartenait le jour du vote : pour, contre,
        abstention, non-votants. Les législatures concernées sont les 15e, 16e et 17e. Le groupe est
        celui du référentiel de l{"'"}Assemblée à cette date, pas celui que le député occupe aujourd
        {"'"}hui.
      </p>

      <h3 className="text-xl font-display font-semibold mb-3">
        Ce que le tableau est, et n{"'"}est pas
      </h3>
      <p className="text-muted-foreground mb-4">
        Le vote de chaque député est publié par l{"'"}Assemblée, nom par nom. Le décompte par groupe
        affiché plus haut sur la page est publié lui aussi par l{"'"}Assemblée. Ce tableau-ci est
        autre chose : une addition faite par PoliGraph, à partir des votes individuels et des
        groupes à la date du scrutin. PoliGraph ne calcule aucune position majoritaire. « Pour 12,
        contre 3 » décrit un groupe divisé, pas une décision du groupe.
      </p>
      <p className="text-muted-foreground mb-8">
        Ces chiffres ne servent pas à qualifier le vote d{"'"}un député en particulier. Les
        non-votants sont comptés à part, ils ne sont rangés ni parmi les pour, ni parmi les contre,
        ni parmi les abstentions.
      </p>

      <h3 className="text-xl font-display font-semibold mb-3">
        Quand le tableau est incomplet ou absent
      </h3>
      <p className="text-muted-foreground mb-4">
        PoliGraph compare d{"'"}abord la somme des votes individuels au résultat officiel du
        scrutin. Un groupe n{"'"}est présenté que si ses votes sont tous attestés et rattachés sans
        doute possible. Sinon le tableau est partiel ou absent, et la raison est écrite.
      </p>
      <dl className="mb-8 space-y-3">
        {CASES.map(({ title, text }) => (
          <div key={title}>
            <dt className="font-medium">{title}</dt>
            <dd className="text-sm text-muted-foreground">{text}</dd>
          </div>
        ))}
      </dl>

      <h3 className="text-xl font-display font-semibold mb-3">Sources</h3>
      <p className="text-muted-foreground">
        Deux jeux de données ouverts de l{"'"}Assemblée nationale : les scrutins avec le vote de
        chaque député, et le référentiel des acteurs et des organes avec leurs dates d{"'"}
        appartenance. Les archives sont figées et contrôlées avant toute lecture. La date de
        consultation figure sous chaque tableau. Pour les autres règles de sourcing, voir{" "}
        <Link href="/sources" className="text-primary hover:underline">
          Sources et principes éditoriaux
        </Link>
        .
      </p>
    </section>
  );
}
