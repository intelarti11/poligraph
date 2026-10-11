import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ElectionScrutinInfo } from "@/components/elections/ElectionScrutinInfo";
import { ELECTION_GUIDES } from "@/config/election-guides";
import { TooltipProvider } from "@/components/ui/tooltip";

// Since the March 2026 municipales (loi du 21 mai 2025), the paritary list ballot applies in every
// commune, below 1,000 inhabitants too (ministère de l'Intérieur). No public text may still restrict
// it to communes of 1,000 inhabitants and more.
const RESTRICTION = /communes de 1 000 habitants et plus[^.]*(paritaires|scrutin)/i;

describe("mode de scrutin des municipales", () => {
  it("la fiche élection ne limite plus le scrutin de liste aux communes de 1 000 habitants", () => {
    const { container } = render(
      <TooltipProvider>
        <ElectionScrutinInfo
          type="MUNICIPALES"
          scope="MUNICIPAL"
          suffrage="DIRECT"
          totalSeats={null}
        />
      </TooltipProvider>
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(RESTRICTION);
    expect(text).toContain("toutes les communes");
  });

  it("le guide pratique ne limite plus la parité des listes aux communes de 1 000 habitants", () => {
    const text = (ELECTION_GUIDES.MUNICIPALES ?? []).map((g) => g.content).join(" ");
    expect(text).not.toMatch(RESTRICTION);
    expect(text).toContain("loi du 21 mai 2025");
  });
});
