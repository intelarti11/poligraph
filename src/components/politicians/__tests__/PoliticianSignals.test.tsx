import type { ComponentProps } from "react";
import type Link from "next/link";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PoliticianSignals } from "@/components/politicians/PoliticianSignals";
import type { Signal } from "@/lib/politicians/signals";
import { mountTabsAnchor } from "./helpers";

// Plain anchor: jsdom has no navigation, and the click has to reach our handler.
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    onClick,
    onNavigate,
    prefetch: _prefetch,
    scroll: _scroll,
    ...props
  }: ComponentProps<typeof Link>) => (
    <a
      href={String(href)}
      onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        onClick?.(e);
        onNavigate?.({ preventDefault: () => e.preventDefault() });
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const signal = (over: Partial<Signal>): Signal => ({
  key: "mandats",
  iconKey: "mandate",
  label: "Mandats",
  value: "8",
  href: "/politiques/x?tab=carriere",
  tone: "neutral",
  primary: true,
  ...over,
});

describe("PoliticianSignals", () => {
  it("renders primary signals as links with label + value", () => {
    render(<PoliticianSignals signals={[signal({})]} />);
    const link = screen.getByRole("link", { name: /Mandats/ });
    expect(link).toHaveAttribute("href", "/politiques/x?tab=carriere");
    expect(link).toHaveTextContent("8");
  });

  it("brings the tabs into view when a card is clicked", () => {
    window.history.replaceState(null, "", "/politiques/x");
    const anchor = mountTabsAnchor();
    render(<PoliticianSignals signals={[signal({})]} />);

    fireEvent.click(screen.getByRole("link", { name: /Mandats/ }));

    expect(anchor.scrollIntoView).toHaveBeenCalled();
  });

  it("does not render non-primary signals as cards", () => {
    render(
      <PoliticianSignals
        signals={[signal({ key: "mentionne", label: "Mentionné / secondaire", primary: false })]}
      />
    );
    expect(screen.queryByRole("link", { name: /Mentionné/ })).toBeNull();
  });
});
