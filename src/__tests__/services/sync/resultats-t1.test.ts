import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { parseCommuneResultsHtml } from "@/services/sync/resultats-t1";

// 7-column table (communes >= 1000 hab): with Nuance column
const HTML_WITH_NUANCE = `
<html><body>
<table><caption>Mentions 1er tour</caption>
<tbody>
  <tr><td>Inscrits</td><td>5 000</td></tr>
  <tr><td>Votants</td><td>3 500</td></tr>
  <tr><td>Blancs</td><td>50</td></tr>
  <tr><td>Nuls</td><td>30</td></tr>
  <tr><td>Exprimés</td><td>3 420</td></tr>
</tbody></table>
<table><caption>Résultats au 1er tour</caption>
<thead><tr><th>Liste</th><th>Conduite par</th><th>Nuance</th><th>Voix</th><th>% Inscrits</th><th>% Exprimés</th><th>Sièges</th></tr></thead>
<tbody>
  <tr><td>LISTE A</td><td>Jean DUPONT</td><td>DVG</td><td>2 000</td><td>40,00</td><td>58,48</td><td>25</td></tr>
  <tr><td>LISTE B</td><td>Marie MARTIN</td><td>DVD</td><td>1 420</td><td>28,40</td><td>41,52</td><td>8</td></tr>
</tbody></table>
<h5 class="fr-h2">Grande Ville (31)</h5>
</body></html>
`;

// 6-column table (communes < 1000 hab): WITHOUT Nuance column
const HTML_WITHOUT_NUANCE = `
<html><body>
<table><caption>Mentions 1er tour</caption>
<tbody>
  <tr><td>Inscrits</td><td>285</td></tr>
  <tr><td>Votants</td><td>251</td></tr>
  <tr><td>Blancs</td><td>4</td></tr>
  <tr><td>Nuls</td><td>6</td></tr>
  <tr><td>Exprimés</td><td>241</td></tr>
</tbody></table>
<table><caption>Résultats au 1er tour</caption>
<thead><tr><th>Liste</th><th>Conduite par</th><th>Voix</th><th>% Inscrits</th><th>% Exprimés</th><th>Sièges</th></tr></thead>
<tbody>
  <tr><td>MIEUX VIVRE</td><td>Charlotte PEREFARRES</td><td>207</td><td>72,63</td><td>85,89</td><td>14</td></tr>
  <tr><td>HERITAGE</td><td>Gérard ROUX</td><td>34</td><td>11,93</td><td>14,11</td><td>1</td></tr>
</tbody></table>
<h5 class="fr-h2">Saint-Béat-Lez (31)</h5>
</body></html>
`;

describe("parseCommuneResultsHtml", () => {
  it("parses 7-column table (with Nuance) correctly", () => {
    const result = parseCommuneResultsHtml(HTML_WITH_NUANCE, "31000");

    expect(result).not.toBeNull();
    expect(result!.registeredVoters).toBe(5000);
    expect(result!.validVotes).toBe(3420);

    expect(result!.lists).toHaveLength(2);
    expect(result!.lists[0]).toMatchObject({
      listName: "LISTE A",
      leaderName: "Jean DUPONT",
      nuance: "DVG",
      round1Votes: 2000,
      round1Pct: 58.48,
      isElected: true, // >50% and seats > 0
    });
    expect(result!.lists[1]).toMatchObject({
      round1Votes: 1420,
      round1Pct: 41.52,
      isElected: false,
    });
  });

  it("parses 6-column table (without Nuance) correctly", () => {
    const result = parseCommuneResultsHtml(HTML_WITHOUT_NUANCE, "31471");

    expect(result).not.toBeNull();
    expect(result!.registeredVoters).toBe(285);
    expect(result!.validVotes).toBe(241);

    expect(result!.lists).toHaveLength(2);
    expect(result!.lists[0]).toMatchObject({
      listName: "MIEUX VIVRE",
      leaderName: "Charlotte PEREFARRES",
      nuance: "",
      round1Votes: 207,
      round1Pct: 85.89,
      isElected: true, // 85.89% > 50 and 14 seats > 0
    });
    expect(result!.lists[1]).toMatchObject({
      listName: "HERITAGE",
      round1Votes: 34,
      round1Pct: 14.11,
      isElected: false,
    });
  });

  it("returns null for pages with no results", () => {
    const html = "<html><body>résultats non parvenus</body></html>";
    expect(parseCommuneResultsHtml(html, "00000")).toBeNull();
  });
});

describe("parseCommuneResultsHtml : quart des inscrits (art. L. 262)", () => {
  const page = (votesA: string, pctA: string, votesB: string, pctB: string) => `
<html><body>
<table><caption>Mentions 1er tour</caption>
<tbody>
  <tr><td>Inscrits</td><td>5 000</td></tr>
  <tr><td>Votants</td><td>1 600</td></tr>
  <tr><td>Blancs</td><td>50</td></tr>
  <tr><td>Nuls</td><td>30</td></tr>
  <tr><td>Exprimés</td><td>1 520</td></tr>
</tbody></table>
<table><caption>Résultats au 1er tour</caption>
<thead><tr><th>Liste</th><th>Conduite par</th><th>Nuance</th><th>Voix</th><th>% Inscrits</th><th>% Exprimés</th><th>Sièges</th></tr></thead>
<tbody>
  <tr><td>LISTE A</td><td>Jean DUPONT</td><td>DVG</td><td>${votesA}</td><td>x</td><td>${pctA}</td><td>25</td></tr>
  <tr><td>LISTE B</td><td>Marie MARTIN</td><td>DVD</td><td>${votesB}</td><td>x</td><td>${pctB}</td><td>8</td></tr>
</tbody></table>
<h5 class="fr-h2">Ville (31)</h5>
</body></html>`;

  it("n'élit pas une liste à plus de 50 % des exprimés sous le quart des inscrits", () => {
    const r = parseCommuneResultsHtml(page("1 000", "65,79", "520", "34,21"), "31000");
    expect(r?.lists[0]?.isElected).toBe(false);
  });

  it("élit une liste qui atteint exactement le quart des inscrits", () => {
    const r = parseCommuneResultsHtml(page("1 250", "82,24", "270", "17,76"), "31000");
    expect(r?.lists[0]?.isElected).toBe(true);
  });
});
