/** « 2024-06-09 » devient « 9 juin 2024 ». Fuseau UTC : une date calendaire ne se décale pas. */
export function formatIsoDateFr(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
