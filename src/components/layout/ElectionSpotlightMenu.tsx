"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

export interface ElectionSpotlightLink {
  href: string;
  label: string;
  description?: string;
}

interface ElectionSpotlightMenuProps {
  election: ElectionSpotlightLink;
  /** Extra destinations under the election (Programmes when enabled, then every election) */
  links: ElectionSpotlightLink[];
}

/**
 * Desktop pill for the election put forward, opening a small panel of links.
 *
 * A disclosure, not an ARIA menu: the panel holds plain navigation links, which Tab reaches in
 * order. Escape closes it and returns focus to the button, as does a click outside.
 */
export function ElectionSpotlightMenu({ election, links }: ElectionSpotlightMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback((restoreFocus: boolean) => {
    setIsOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    panelRef.current?.querySelector<HTMLElement>("a")?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    // Focus leaving the widget (Tab past the last link) closes it, so the panel never floats
    // over a page the keyboard has already moved on to.
    const onFocusIn = (e: FocusEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [isOpen, close]);

  const linkClass =
    "flex min-h-11 flex-col justify-center rounded-lg px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="flex items-center gap-1 whitespace-nowrap rounded-full bg-primary px-2.5 py-1.5 text-[13px] font-semibold xl:px-3 xl:text-sm text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {election.label}
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 transition-transform motion-reduce:transition-none ${isOpen ? "rotate-180" : ""}`}
        />
      </button>
      <div
        ref={panelRef}
        id={panelId}
        hidden={!isOpen}
        className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg"
      >
        <ul className="space-y-1">
          <li>
            <Link href={election.href} className={linkClass} onClick={() => close(false)}>
              <span className="font-semibold">{election.label}</span>
              {election.description && (
                <span className="text-xs text-muted-foreground">{election.description}</span>
              )}
            </Link>
          </li>
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className={linkClass} onClick={() => close(false)}>
                <span className="font-medium">{link.label}</span>
                {link.description && (
                  <span className="text-xs text-muted-foreground">{link.description}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
