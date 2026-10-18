/**
 * Reading of a Météo-France climatological sheet (`FICHECLIM_<id>.data`), lot R3 of "Le territoire
 * en chiffres" (#1052). Pure: the text goes in, the station comes out.
 *
 * Every block of a sheet states its own period. The title says "1991-2020" but a station opened
 * in 2002 has its means "établies sur la période 2002-2020": the period is read per block and
 * travels with the figure, never assumed.
 */

/** An annual figure with the years it was measured over. */
export interface FicheMeasure {
  value: number;
  startYear: number;
  endYear: number;
}

export interface FicheStation {
  id: string;
  name: string;
  /** As written in the header: "01", "20" (Corsica as a whole), "971"... */
  departmentCode: string;
  altitudeM: number;
  lat: number;
  lon: number;
  tempMoyenne: FicheMeasure | null;
  precipitations: FicheMeasure | null;
}

const HEADER =
  /^(.+?) \((\w+)\)\s+Indicatif : (\w+), alt : (-?\d+)m, lat : (\d+)°(\d+)'(\d+)"([NS]), lon : (\d+)°(\d+)'(\d+)"([EO])/;
const TITLE_PERIOD = /^Statistiques\s+(\d{4})-(\d{4})\s+et\s+records/;
const BLOCK_PERIOD = /^Statistiques établies sur la période (\d{4})-(\d{4})/;

const TEMP_TITLE = "Température moyenne";
const PRECIP_TITLE = "Précipitations : Hauteur moyenne mensuelle";
/** First cell is the label, then twelve months, then the year. */
const ANNUAL_CELL = 13;

/** Degrees, minutes, seconds to decimal degrees. South and West (Ouest) are negative. */
export function dmsToDecimal(
  deg: number,
  min: number,
  sec: number,
  hemisphere: "N" | "S" | "E" | "O"
): number {
  const abs = deg + min / 60 + sec / 3600;
  return hemisphere === "S" || hemisphere === "O" ? -abs : abs;
}

/**
 * The corsican communes are coded 2A and 2B, the sheets say "20" for the whole island. Every
 * other code is the same on both sides.
 */
export function ficheDepartmentOf(communeDepartmentCode: string): string {
  return communeDepartmentCode === "2A" || communeDepartmentCode === "2B"
    ? "20"
    : communeDepartmentCode;
}

function blockMeasure(lines: string[], title: string, defaultPeriod: [number, number] | null) {
  const at = lines.findIndex((l) => l.startsWith(title));
  if (at === -1) return null;
  let next = at + 1;
  let period = defaultPeriod;
  const stated = BLOCK_PERIOD.exec(lines[next] ?? "");
  if (stated) {
    period = [Number(stated[1]), Number(stated[2])];
    next++;
  }
  if (!period) return null;
  const cells = (lines[next] ?? "").split(";").map((c) => c.trim());
  const raw = cells[ANNUAL_CELL] ?? "";
  // "." is the producer's mark for "no value": it stays absent, never zero.
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return null;
  return { value: Number(raw), startYear: period[0], endYear: period[1] };
}

/** Null when the header cannot be read: the sheet is then reported, not guessed. */
export function parseFiche(text: string): FicheStation | null {
  const lines = text.replace(/\r/g, "").split("\n");
  const head = HEADER.exec(lines.find((l) => l.includes("Indicatif")) ?? "");
  if (!head) return null;
  const title = TITLE_PERIOD.exec(lines.find((l) => TITLE_PERIOD.test(l)) ?? "");
  const defaultPeriod: [number, number] | null = title
    ? [Number(title[1]), Number(title[2])]
    : null;
  return {
    id: head[3] as string,
    name: (head[1] as string).trim(),
    departmentCode: head[2] as string,
    altitudeM: Number(head[4]),
    lat: dmsToDecimal(Number(head[5]), Number(head[6]), Number(head[7]), head[8] as "N" | "S"),
    lon: dmsToDecimal(Number(head[9]), Number(head[10]), Number(head[11]), head[12] as "E" | "O"),
    tempMoyenne: blockMeasure(lines, TEMP_TITLE, defaultPeriod),
    precipitations: blockMeasure(lines, PRECIP_TITLE, defaultPeriod),
  };
}
