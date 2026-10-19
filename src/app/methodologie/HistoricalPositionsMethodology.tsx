import Link from "next/link";

export const HISTORICAL_POSITIONS_SECTION_ID = "votes-historiques-des-groupes";

const MISSING_CASES: { title: string; text: string }[] = [
  {
    title: "Les totaux ne concordent pas",
    text: "La somme des votes individuels diffère du résultat publié par l'Assemblée pour ce scrutin. Un écart peut venir d'un classement ou d'un périmètre différent. PoliGraph ne peut pas le réconcilier avec assez de certitude, et n'affiche aucun tableau.",
  },
  {
    title: "Les totaux ne peuvent pas être comparés",
    text: "Le résultat officiel du scrutin n'est pas exploitable, donc le contrôle n'a pas lieu. Rien n'est affiché, et le message le distingue du cas précédent.",
  },
  {
    title: "Le groupe d'un député est incertain",
    text: "Les données de l'Assemblée donnent des groupes contradictoires, ou aucun groupe, pour un député à cette date. Son vote n'est compté dans aucun groupe, le groupe concerné n'est pas présenté, et le nombre de votes laissés de côté est indiqué.",
  },
  {
    title: "Un groupe sans vote pour, contre ou abstention",
    text: "Tous les membres du groupe sont classés non-votants, ou aucun vote n'est enregistré pour lui. Il figure dans la liste des groupes non présentés, avec cette raison.",
  },
  {
    title: "Les non-inscrits",
    text: "Les députés non inscrits n'appartiennent à aucun groupe, il n'y a donc pas de ligne pour eux. Leurs votes ne disparaissent pas du scrutin : ils sont dans le résultat officiel, et le nombre de votes concernés est mentionné sous le tableau.",
  },
  {
    title: "Un groupe renommé",
    text: "Quand deux références de l'Assemblée portent le même sigle dans une législature, chacune a sa ligne. PoliGraph n'affirme pas qu'il s'agit du même groupe.",
  },
  {
    title: "Pas de données pour ce scrutin",
    text: "La législature n'est pas couverte, ou aucune donnée contrôlée n'existe pour ce scrutin. Le bloc le dit. Ce n'est pas une absence de vote.",
  },
];

/**
 * Methodology of the dated group counts on the scrutin page. Rendered by the methodology page only
 * while HISTORICAL_GROUP_POSITIONS_PUBLIC is on, so the page never describes a block the site does
 * not show. Four questions, in the order a reader asks them.
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

      <h3 className="text-xl font-display font-semibold mb-3">Que montre le tableau ?</h3>
      <p className="text-muted-foreground mb-4">
        Pour un scrutin public de l{"'"}Assemblée nationale (15e, 16e et 17e législatures),
        PoliGraph retrouve le groupe auquel chaque député appartenait le jour du vote, puis compte
        combien de membres de chaque groupe ont voté pour, contre, se sont abstenus ou sont classés
        non-votants. Le groupe est celui de cette date, pas celui que le député occupe aujourd
        {"'"}hui.
      </p>
      <p className="text-muted-foreground mb-8">
        Pour les non-votants, PoliGraph reprend le classement de l{"'"}Assemblée sans l{"'"}
        interpréter : il ne dit pas si le député était absent, ou s{"'"}il n{"'"}a pas voulu voter.
      </p>

      <h3 className="text-xl font-display font-semibold mb-3">D{"'"}où viennent les chiffres ?</h3>
      <p className="text-muted-foreground mb-8">
        De deux jeux de données ouverts de l{"'"}Assemblée nationale : les scrutins, avec le vote de
        chaque député, et les groupes et mandats des députés, avec leurs dates. PoliGraph travaille
        sur des versions identifiées de ces fichiers, contrôlées puis conservées, pour que chaque
        chiffre puisse être revérifié. Sous le tableau, la date indiquée est celle où PoliGraph a lu
        le fichier des scrutins, pas la date de publication par l{"'"}Assemblée. Pour les autres
        règles de sourcing, voir{" "}
        <Link href="/sources" className="text-primary hover:underline">
          Sources et principes éditoriaux
        </Link>
        .
      </p>

      <h3 className="text-xl font-display font-semibold mb-3">
        Pourquoi des chiffres peuvent manquer
      </h3>
      <p className="text-muted-foreground mb-4">
        PoliGraph compare d{"'"}abord la somme des votes individuels au résultat officiel. Un groupe
        n{"'"}est présenté que lorsque les sources concordent et que ces contrôles sont satisfaits.
        Sinon, PoliGraph préfère ne rien afficher plutôt que risquer une attribution erronée, et
        écrit la raison.
      </p>
      <dl className="mb-8 space-y-3">
        {MISSING_CASES.map(({ title, text }) => (
          <div key={title}>
            <dt className="font-medium">{title}</dt>
            <dd className="text-sm text-muted-foreground">{text}</dd>
          </div>
        ))}
      </dl>

      <h3 className="text-xl font-display font-semibold mb-3">
        Ce que ces chiffres ne permettent pas de conclure
      </h3>
      <p className="text-muted-foreground">
        Ils ne donnent pas la position officielle d{"'"}un groupe, et PoliGraph n{"'"}en calcule
        aucune. Ils ne disent pas non plus que tous les membres d{"'"}un groupe ont voté de la même
        façon : « pour 12, contre 3 » décrit un groupe partagé, pas une décision collective. Ils ne
        qualifient pas le vote d{"'"}un député en particulier.
      </p>
    </section>
  );
}
