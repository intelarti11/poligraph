import { BRAND_NAVY, BRAND_PAGE, BRAND_RED } from "@/config/brand";
import { DEPARTMENTS } from "@/config/departments";
import {
  DEPARTMENT_OUTLINES,
  FRANCE_DROM_INSETS,
  FRANCE_MINI_OUTLINE,
  FRANCE_OUTLINE,
  REGION_OUTLINES,
  projectInDepartment,
  type TerritoryGroupOutline,
} from "@/config/territoires-shapes";
import { cn } from "@/lib/utils";

/**
 * Decorative outline of a territory. Always `aria-hidden`: every fact it suggests (which
 * department, which region, where the commune sits) must also be in the page text.
 *
 * Renders nothing when the outline is missing (TAAF, Clipperton, unknown code): a banner
 * without a silhouette is correct, the outline of another territory never is.
 */

type Tone = "marine" | "clair";

interface CommonProps {
  /** `marine`: on the navy banner. `clair`: on a light card. */
  tone?: Tone;
  className?: string;
}

interface DepartementProps extends CommonProps {
  kind: "departement";
  code: string;
  /** Commune position; dropped if it falls outside the department's frame. */
  marker?: { lat: number; lon: number } | null;
}

interface RegionProps extends CommonProps {
  kind: "region";
  /** Region name as written in DEPARTMENTS (src/config/departments.ts). */
  region: string;
}

interface FranceProps extends CommonProps {
  kind: "france";
  /**
   * `mini` is the lighter drawing meant for a ~100 px inset, metropolitan France only. `full`
   * adds the five DROM in boxes under metropolitan France.
   */
  size?: "full" | "mini";
  highlightDepartment?: string;
  highlightRegion?: string;
  /**
   * Optional mouse shortcut per region. The links are out of the tab order and hidden from
   * assistive tech: the page must carry the real navigation as a text list of links.
   */
  regionHref?: (region: string) => string | undefined;
}

export type TerritoryShapeProps = DepartementProps | RegionProps | FranceProps;

const PALETTE: Record<
  Tone,
  { fill: string; fillOpacity: number; stroke: string; highlight: string; markerCore: string }
> = {
  marine: {
    fill: BRAND_PAGE,
    fillOpacity: 0.1,
    stroke: BRAND_PAGE,
    highlight: BRAND_PAGE,
    markerCore: BRAND_PAGE,
  },
  clair: {
    fill: BRAND_NAVY,
    fillOpacity: 0.06,
    stroke: BRAND_NAVY,
    highlight: BRAND_NAVY,
    markerCore: BRAND_NAVY,
  },
};

function has<T>(record: Readonly<Record<string, T>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function Svg({
  viewBox,
  className,
  children,
}: {
  viewBox: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox={viewBox}
      aria-hidden="true"
      focusable="false"
      className={cn("block h-auto w-full", className)}
      fillRule="evenodd"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function TerritoryShape(props: TerritoryShapeProps) {
  const tone = props.tone ?? "marine";
  const colors = PALETTE[tone];

  if (props.kind === "departement") {
    if (!has(DEPARTMENT_OUTLINES, props.code)) return null;
    const outline = DEPARTMENT_OUTLINES[props.code]!;
    const [, , width, height] = outline.viewBox.split(" ").map(Number) as [
      number,
      number,
      number,
      number,
    ];
    const point = props.marker
      ? projectInDepartment(props.code, props.marker.lon, props.marker.lat)
      : null;
    const showMarker =
      point !== null && point[0] >= 0 && point[0] <= width && point[1] >= 0 && point[1] <= height;
    return (
      <Svg viewBox={outline.viewBox} className={props.className}>
        <path
          d={outline.d}
          fill={colors.fill}
          fillOpacity={colors.fillOpacity}
          stroke={colors.stroke}
          strokeOpacity={0.7}
          strokeWidth={2}
        />
        {showMarker && (
          <g data-territory-marker="">
            <circle cx={point[0]} cy={point[1]} r={14} fill={BRAND_RED} fillOpacity={0.35} />
            <circle cx={point[0]} cy={point[1]} r={6} fill={colors.markerCore} />
          </g>
        )}
      </Svg>
    );
  }

  if (props.kind === "region") {
    if (!has(REGION_OUTLINES, props.region)) return null;
    const outline = REGION_OUTLINES[props.region]!;
    return (
      <Svg viewBox={outline.viewBox} className={props.className}>
        {Object.entries(outline.departments).map(([code, d]) => (
          <path
            key={code}
            d={d}
            fill={colors.fill}
            fillOpacity={colors.fillOpacity}
            stroke={colors.stroke}
            strokeOpacity={0.6}
            strokeWidth={1.2}
          />
        ))}
      </Svg>
    );
  }

  return <FranceShape {...props} colors={colors} />;
}

function FranceShape({
  size = "full",
  highlightDepartment,
  highlightRegion,
  regionHref,
  className,
  colors,
}: FranceProps & { colors: (typeof PALETTE)[Tone] }) {
  const outline: TerritoryGroupOutline = size === "mini" ? FRANCE_MINI_OUTLINE : FRANCE_OUTLINE;
  const insets = size === "full" ? FRANCE_DROM_INSETS.boxes : [];
  const halo =
    size === "mini" && highlightDepartment !== undefined
      ? FRANCE_MINI_OUTLINE.smallAnchors[highlightDepartment]
      : undefined;
  // Asked to point at a territory the map cannot show: draw nothing rather than a France
  // that suggests the territory is elsewhere or absent.
  if (
    highlightDepartment !== undefined &&
    !has(outline.departments, highlightDepartment) &&
    !insets.some((inset) => inset.code === highlightDepartment)
  ) {
    return null;
  }
  if (
    highlightRegion !== undefined &&
    (!has(REGION_OUTLINES, highlightRegion) ||
      (FRANCE_DROM_INSETS.boxes.some((inset) => inset.region === highlightRegion) &&
        !insets.some((inset) => inset.region === highlightRegion)))
  ) {
    return null;
  }

  const strokeWidth = size === "mini" ? 0.6 : 0.8;
  const byRegion = new Map<string, [string, string][]>();
  for (const [code, d] of Object.entries(outline.departments)) {
    const region = DEPARTMENTS[code]?.region ?? "";
    const list = byRegion.get(region) ?? [];
    list.push([code, d]);
    byRegion.set(region, list);
  }

  return (
    <Svg
      viewBox={insets.length ? FRANCE_DROM_INSETS.viewBox : outline.viewBox}
      className={className}
    >
      {[...byRegion].map(([region, departments]) => {
        const regionHighlighted = region === highlightRegion;
        const paths = departments.map(([code, d]) => {
          const highlighted = regionHighlighted || code === highlightDepartment;
          const fill = code === highlightDepartment ? BRAND_RED : colors.highlight;
          return (
            <path
              key={code}
              d={d}
              fill={highlighted ? fill : colors.fill}
              fillOpacity={highlighted ? 0.9 : colors.fillOpacity}
              stroke={colors.stroke}
              strokeOpacity={0.35}
              strokeWidth={strokeWidth}
            />
          );
        });
        const href = regionHref?.(region);
        return href ? (
          <a key={region} href={href} tabIndex={-1}>
            {paths}
          </a>
        ) : (
          <g key={region}>{paths}</g>
        );
      })}
      {halo && <circle cx={halo[0]} cy={halo[1]} r={6} fill={BRAND_RED} fillOpacity={0.9} />}
      {insets.map(({ code, region, box, d }) => {
        const highlighted = region === highlightRegion || code === highlightDepartment;
        const fill = code === highlightDepartment ? BRAND_RED : colors.highlight;
        const content = (
          <>
            <rect
              x={box[0]}
              y={box[1]}
              width={box[2]}
              height={box[3]}
              rx={4}
              fill={colors.fill}
              fillOpacity={0}
              stroke={colors.stroke}
              strokeOpacity={0.35}
              strokeWidth={strokeWidth}
            />
            <path
              d={d}
              fill={highlighted ? fill : colors.fill}
              fillOpacity={highlighted ? 0.9 : colors.fillOpacity}
              stroke={colors.stroke}
              strokeOpacity={0.35}
              strokeWidth={strokeWidth}
            />
          </>
        );
        const href = regionHref?.(region);
        return href ? (
          <a key={code} href={href} tabIndex={-1} data-drom={code}>
            {content}
          </a>
        ) : (
          <g key={code} data-drom={code}>
            {content}
          </g>
        );
      })}
    </Svg>
  );
}
