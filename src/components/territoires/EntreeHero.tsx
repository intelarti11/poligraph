import { BandeauSurtitre, EntreeRegionBandeau } from "./EntreeRegionBandeau";
import { TerritoireSearch } from "./TerritoireSearch";

export function EntreeHero({ query = "" }: { query?: string }) {
  return (
    <EntreeRegionBandeau labelledBy="territoires-titre">
      <div className="max-w-3xl">
        <BandeauSurtitre>Territoires · communes, départements, régions</BandeauSurtitre>
        <h1
          id="territoires-titre"
          className="mt-4 font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl"
        >
          Les élus et les décisions de votre territoire
        </h1>
        <p className="mt-4 max-w-2xl text-base text-white/85 sm:text-lg">
          Commune, département, région : qui exerce quel mandat et les résultats des élections, avec
          la source officielle de chaque information.
        </p>
        <div className="mt-6 max-w-xl">
          <TerritoireSearch defaultValue={query} />
        </div>
      </div>
    </EntreeRegionBandeau>
  );
}
