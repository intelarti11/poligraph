import Link from "next/link";

export const HISTORICAL_POSITIONS_SECTION_ID = "votes-historiques-des-groupes";

const MISSING_CASES: { title: string; text: string }[] = [
  {
    title: "Les totaux ne concordent pas",
    text: "La somme des votes individuels diffère du résultat publié par l'Assemblée pour ce scrutin. PoliGraph n'a pas pu expliquer l'écart : aucun tableau n'est affiché.",
  },
  {
    title: "Les totaux ne peuvent pas être comparés",
    text: "Le résultat publié pour ce scrutin ne permet pas de contrôler les votes individuels. Rien n'est affiché.",
  },
  {
    title: "Le groupe d'un député est incertain",
    text: "Les deux fichiers de l'Assemblée donnent des groupes différents, ou aucun groupe, pour un député à cette date. Son vote n'est compté dans aucun groupe. Le groupe concerné n'est pas présenté, et le nombre de votes laissés de côté est indiqué.",
  },
  {
    title: "Un groupe sans vote pour, contre ou abstention",
    text: "Tous ses membres sont classés non-votants, ou aucun vote n'est enregistré pour lui. Il figure dans la liste des groupes non présentés, avec cette raison.",
  },
  {
    title: "Les députés non inscrits",
    text: "Ils ne forment pas un groupe, donc le tableau n'a pas de ligne pour eux. Leurs votes restent dans le résultat officiel, et le nombre de votes concernés est indiqué sous le tableau.",
  },
  {
    title: "Un groupe renommé",
    text: "Quand deux références de l'Assemblée portent le même sigle dans un même scrutin, chacune a sa ligne. PoliGraph n'affirme pas qu'il s'agit du même groupe.",
  },
  {
    title: "Pas de données pour ce scrutin",
    text: "La législature n'est pas couverte, ou aucune donnée contrôlée n'existe pour ce scrutin. Le bloc le dit : ce n'est pas une absence de vote.",
  },
];

/**
 * Methodology of the dated group counts on the scrutin page. Rendered by the methodology page only
 * while HISTORICAL_GROUP_POSITIONS_PUBLIC is on, so the page never describes a block the site does
 * not show. Four questions, in the order a reader asks them. The 15th legislature is not named:
 * the site holds no scrutin of it, so no page shows this block for it.
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
        Pour un scrutin public de l&apos;Assemblée nationale (16e et 17e législatures),
        l&apos;Assemblée publie le décompte par groupe avec le résultat. PoliGraph l&apos;affiche
        tel quel quand il l&apos;a repris et que les chiffres s&apos;additionnent au total du
        scrutin. Quand ce décompte est absent ou ne passe pas ces contrôles, PoliGraph en établit un
        à partir des votes individuels, si les sources permettent de le vérifier : il retrouve le
        groupe auquel chaque député appartenait le jour du vote, puis compte, pour chaque groupe,
        les pour, les contre, les abstentions et les non-votants. Le groupe est celui de cette date,
        pas celui que le député occupe aujourd&apos;hui.
      </p>
      <p className="text-muted-foreground mb-8">
        Pour les non-votants, PoliGraph reprend le classement de l&apos;Assemblée sans
        l&apos;interpréter. L&apos;Assemblée y range notamment les membres du Gouvernement et la
        personne qui préside la séance. Cette catégorie ne dit pas pourquoi un député y figure.
      </p>

      <h3 className="text-xl font-display font-semibold mb-3">D{"'"}où viennent les chiffres ?</h3>
      <p className="text-muted-foreground mb-8">
        De deux jeux de données ouverts de l&apos;Assemblée nationale : les scrutins, qui donnent le
        vote de chaque député, et les acteurs, mandats et organes, qui donnent les groupes et leurs
        dates. PoliGraph travaille sur des versions identifiées de ces fichiers, contrôlées puis
        conservées, pour que chaque chiffre puisse être revérifié. Sous le tableau, la date de
        consultation est celle où PoliGraph a lu le fichier des scrutins, pas la date de publication
        par l&apos;Assemblée. La mention « Groupes et mandats arrêtés au » donne la date à laquelle
        le fichier des groupes est arrêté. Pour les autres règles de sourcing, voir{" "}
        <Link href="/sources" className="text-primary hover:underline">
          Sources et principes éditoriaux
        </Link>
        .
      </p>

      <h3 className="text-xl font-display font-semibold mb-3">
        Pourquoi des chiffres peuvent manquer
      </h3>
      <p className="text-muted-foreground mb-4">
        PoliGraph vérifie d&apos;abord que les votes individuels concordent avec le résultat
        officiel du scrutin, puis contrôle le groupe de chaque député au moment du vote. Si ces
        vérifications ne permettent pas d&apos;établir un décompte fiable, les chiffres concernés ne
        sont pas présentés et la raison est indiquée.
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
        Ils ne donnent pas la position d&apos;un groupe, et PoliGraph n&apos;en calcule aucune. «
        Pour 12, contre 3 » décrit un groupe partagé, pas une décision collective, et ne dit rien du
        vote d&apos;un député en particulier.
      </p>
    </section>
  );
}
