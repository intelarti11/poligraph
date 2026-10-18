"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { revealProfileTabs } from "./profile-tabs-anchor";

/**
 * Tab bodies are already mounted in the profile's client boundary. Native
 * history updates useSearchParams without fetching the same document again.
 */
export function TabShortcutLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  // A few shortcuts point at an in-page anchor (#dossiers) instead of a tab.
  // The browser already scrolls those, and revealing the tabs would fight it.
  const opensTab = /[?&]tab=/.test(href);

  return (
    <Link
      href={href}
      prefetch={false}
      scroll={false}
      className={className}
      onNavigate={(event) => {
        if (!opensTab) return;
        const target = new URL(href, window.location.href);
        if (target.pathname !== window.location.pathname) return;

        event.preventDefault();
        window.history.pushState(null, "", `${target.pathname}${target.search}${target.hash}`);
        revealProfileTabs();
      }}
    >
      {children}
    </Link>
  );
}
