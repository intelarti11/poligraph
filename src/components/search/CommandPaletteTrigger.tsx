"use client";

import { Search } from "lucide-react";
import { useCommandPalette } from "./CommandPaletteProvider";

export function CommandPaletteTrigger() {
  const { open } = useCommandPalette();
  const isMac = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");

  return (
    <button
      type="button"
      onClick={open}
      className="hidden 2xl:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-input bg-background text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors min-w-[200px]"
      aria-label="Rechercher (Cmd+K)"
    >
      <Search className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">Rechercher...</span>
      <kbd className="inline-flex h-5 items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
        {isMac ? "⌘" : "Ctrl+"}K
      </kbd>
    </button>
  );
}

/**
 * The search button for the narrower desktop windows, from `lg` up to `2xl`.
 *
 * At `lg` the whole desktop navigation appears at once, and the full trigger above carries a
 * `min-w-[200px]` that pushes the header past the viewport. With six sections and the election
 * pill, the labels only keep their room if search shrinks to this icon until `2xl`: the
 * container stays capped at 1280px up to a 1536px viewport, so 1440px has no more room than
 * 1280px. Ctrl+K works at every width.
 *
 * Not a mobile button despite what its previous name said: below `lg` the header renders its own
 * search button in `MobileMenu`, and this component is inside a `hidden lg:flex` nav.
 */
export function CommandPaletteTriggerCompact() {
  const { open } = useCommandPalette();

  return (
    <button
      type="button"
      onClick={open}
      className="hidden lg:flex 2xl:hidden items-center justify-center h-9 w-9 rounded-lg text-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
      aria-label="Rechercher"
      title="Rechercher (Ctrl+K)"
    >
      <Search className="h-[18px] w-[18px]" />
    </button>
  );
}
