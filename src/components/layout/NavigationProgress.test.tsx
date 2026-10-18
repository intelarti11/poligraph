import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NavigationProgress } from "./NavigationProgress";

const route = vi.hoisted(() => ({ pathname: "/politiques/x", search: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => route.search,
}));

beforeEach(() => {
  route.pathname = "/politiques/x";
  route.search = new URLSearchParams();
  window.history.replaceState(null, "", route.pathname);
});

function renderProgress(href: string) {
  return render(
    <>
      <NavigationProgress />
      <a href={href} onClick={(event) => event.preventDefault()}>
        Destination
      </a>
      <button>Suivre</button>
    </>
  );
}

describe("NavigationProgress", () => {
  it("does not wait for a route completion after a same-page anchor", () => {
    const { container } = renderProgress("/politiques/x#dossiers");
    fireEvent.click(screen.getByRole("link"));
    expect(container.querySelector(".animate-progress-bar")).toBeNull();
  });

  it("keeps the page interactive while a route is pending", () => {
    const { container } = renderProgress("/politiques/y");
    fireEvent.click(screen.getByRole("link"));
    const indicator = container.querySelector(".animate-progress-bar");
    expect(indicator).not.toBeNull();
    expect(indicator?.parentElement).toHaveClass("pointer-events-none");
    expect(container.querySelector(".inset-0")).toBeNull();
  });

  it("ignores clicks that open another browser tab", () => {
    const { container } = renderProgress("/politiques/y");
    fireEvent.click(screen.getByRole("link"), { ctrlKey: true });
    expect(container.querySelector(".animate-progress-bar")).toBeNull();
  });

  it("clears the indicator when the route completes", () => {
    const { container, rerender } = renderProgress("/politiques/y");
    fireEvent.click(screen.getByRole("link"));
    expect(container.querySelector(".animate-progress-bar")).not.toBeNull();
    route.pathname = "/politiques/y";
    rerender(<NavigationProgress />);
    expect(container.querySelector(".animate-progress-bar")).toBeNull();
  });
});
