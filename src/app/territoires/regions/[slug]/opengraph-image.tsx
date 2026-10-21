import { ImageResponse } from "next/og";
import { getRegionTerritoire } from "@/lib/data/territoires";
import { regionOutlineDataUri } from "@/lib/territoires/region-og-shape";
import { OgLayout, OG_SIZE, truncateOg } from "@/lib/og-utils";
import { formatCompte } from "@/lib/territoires/format";

export const alt = "Région sur Poligraph";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getRegionTerritoire(slug);

  if (!data) {
    return new ImageResponse(
      <OgLayout>
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontSize: 32,
          }}
        >
          Région introuvable
        </div>
      </OgLayout>,
      { ...OG_SIZE }
    );
  }

  const { region, presidence } = data;
  const shape = regionOutlineDataUri(region.name);
  const overline = `Région · ${formatCompte(data.departements.length, "département", "départements")}`;
  const presidenceLine =
    presidence.state === "ETABLI" && presidence.person
      ? `Présidence : ${presidence.person.fullName}`
      : presidence.registre
        ? `Présidence : ${presidence.registre.fullName}`
        : null;

  return new ImageResponse(
    <OgLayout>
      <div style={{ display: "flex", flex: 1, justifyContent: "space-between", gap: 40 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ fontSize: 26, color: "#cbd5e1", marginBottom: 16 }}>{overline}</div>
          <div
            style={{
              fontSize: 76,
              fontWeight: 800,
              color: "white",
              lineHeight: 1.05,
              marginBottom: 24,
            }}
          >
            {truncateOg(region.name, 40)}
          </div>
          <div style={{ fontSize: 30, color: "#e2e8f0", marginBottom: 10 }}>
            {`${formatCompte(data.communeCount, "commune", "communes")} · chef-lieu ${region.chefLieu.name}`}
          </div>
          {presidenceLine && (
            <div style={{ fontSize: 30, color: "#e2e8f0" }}>{truncateOg(presidenceLine, 60)}</div>
          )}
        </div>
        {shape && (
          <img src={shape} width={320} height={320} alt="" style={{ objectFit: "contain" }} />
        )}
      </div>
    </OgLayout>,
    { ...OG_SIZE }
  );
}
