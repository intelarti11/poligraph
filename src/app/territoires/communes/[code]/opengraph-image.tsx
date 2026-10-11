import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { BRAND_RED } from "@/config/brand";
import { getCommuneDossier } from "@/lib/data/territoires";
import { OgLayout, OG_SIZE, truncateOg } from "@/lib/og-utils";
import { getDepartmentShapeWithDot } from "@/lib/og-department-shape";
import { formatPopulation, maireSince, territoireLabel } from "@/lib/territoires/commune-display";

export const alt = "Commune sur Poligraph : maire, élus et résultats";
export const size = OG_SIZE;
export const contentType = "image/png";

const SHAPE = 260;

function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  });
}

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  // Same reader as the page: only a public, established mayor is ever named.
  const dossier = await getCommuneDossier(code);
  if (!dossier) notFound();

  const { identity, maire, population } = dossier;
  const since = maireSince(maire);
  const maireLine =
    maire.state === "ETABLI" && maire.person
      ? `Maire : ${maire.person.fullName}${since ? `, depuis ${monthYear(since)}` : ""}`
      : maire.state === "NON_ETABLI"
        ? "Maire : titulaire non établi"
        : null;
  const populationLine =
    population.value != null ? `Population : ${formatPopulation(population.value)}` : null;

  // Metropolitan outlines only: an overseas commune gets no silhouette, never another one.
  const shapeUri = getDepartmentShapeWithDot(
    identity.department.code,
    identity.coordinates?.lat ?? null,
    identity.coordinates?.lon ?? null,
    { width: SHAPE, height: SHAPE },
    { shapeFill: "#ffffff", dotFill: BRAND_RED, dotRadius: 9 }
  );

  const name = truncateOg(identity.name, 40);
  const nameFontSize = name.length > 25 ? 52 : name.length > 15 ? 64 : 76;

  return new ImageResponse(
    <OgLayout>
      <div style={{ display: "flex", flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", fontSize: 24, color: "#cbd5e1", marginBottom: 16 }}>
            {`Commune · ${territoireLabel(identity)}`}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: nameFontSize,
              fontWeight: 800,
              color: "white",
              lineHeight: 1.1,
              marginBottom: 28,
            }}
          >
            {name}
          </div>
          {maireLine && (
            <div style={{ display: "flex", fontSize: 30, color: "#e2e8f0", marginBottom: 12 }}>
              {maireLine}
            </div>
          )}
          {populationLine && (
            <div style={{ display: "flex", fontSize: 30, color: "#e2e8f0" }}>{populationLine}</div>
          )}
          {identity.territoireHorsRegion && (
            <div style={{ display: "flex", fontSize: 24, color: "#cbd5e1", marginTop: 12 }}>
              {`${identity.territoireHorsRegion.statut} hors région`}
            </div>
          )}
        </div>
        {shapeUri && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: SHAPE,
              flexShrink: 0,
            }}
          >
            <img src={shapeUri} width={SHAPE} height={SHAPE} alt="" />
          </div>
        )}
      </div>
    </OgLayout>,
    { ...OG_SIZE }
  );
}
