import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RouterContext } from "next/dist/shared/lib/router-context.shared-runtime";
import type { NextRouter } from "next/router";
import { TabShortcutLink } from "../TabShortcutLink";
import { mountTabsAnchor } from "./helpers";

const router: NextRouter = {
  basePath: "",
  pathname: "/politiques/x",
  route: "/politiques/[slug]",
  query: {},
  asPath: "/politiques/x",
  isFallback: false,
  isReady: true,
  isPreview: false,
  isLocaleDomain: false,
  events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  beforePopState: vi.fn(),
  reload: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  prefetch: vi.fn(),
};

beforeEach(() => {
  window.history.replaceState(null, "", "/politiques/x");
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderShortcut() {
  return render(
    <RouterContext.Provider value={router}>
      <TabShortcutLink href="/politiques/x?tab=carriere">Mandats</TabShortcutLink>
    </RouterContext.Provider>
  );
}

describe("TabShortcutLink with Next Link", () => {
  it("selects a tab through native history without a router navigation", () => {
    const anchor = mountTabsAnchor();
    const history = vi.spyOn(window.history, "pushState");
    renderShortcut();

    fireEvent.click(screen.getByRole("link", { name: "Mandats" }));

    expect(history).toHaveBeenCalledWith(null, "", "/politiques/x?tab=carriere");
    expect(window.location.search).toBe("?tab=carriere");
    expect(anchor.scrollIntoView).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    history.mockRestore();
  });

  it("leaves modified clicks to the browser without moving the current page", () => {
    const anchor = mountTabsAnchor();
    renderShortcut();

    // Suppress jsdom's unimplemented new-tab navigation after Next has handled the event.
    document.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(screen.getByRole("link", { name: "Mandats" }), { ctrlKey: true });

    expect(window.location.search).toBe("");
    expect(anchor.scrollIntoView).not.toHaveBeenCalled();
  });

  it("keeps a usable deep link in the HTML", () => {
    renderShortcut();
    expect(screen.getByRole("link", { name: "Mandats" })).toHaveAttribute(
      "href",
      "/politiques/x?tab=carriere"
    );
  });
});
