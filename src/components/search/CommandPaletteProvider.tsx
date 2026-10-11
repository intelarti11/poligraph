"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface CommandPaletteContextValue {
  isOpen: boolean;
  /** True when the palette was opened through `openWithBack` */
  hasBack: boolean;
  open: () => void;
  /**
   * Opens the palette with somewhere to return: `onBack` runs when the reader leaves without
   * choosing a result (back arrow, Escape). The mobile menu uses it to come back after search.
   */
  openWithBack: (onBack: () => void) => void;
  /** Closes after a result was chosen: no return to where the palette was opened from */
  close: () => void;
  /** Closes without a choice, running the `onBack` given at opening, if any */
  dismiss: () => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue>({
  isOpen: false,
  hasBack: false,
  open: () => {},
  openWithBack: () => {},
  close: () => {},
  dismiss: () => {},
});

export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasBack, setHasBack] = useState(false);
  const onBackRef = useRef<(() => void) | undefined>(undefined);

  const open = useCallback(() => {
    onBackRef.current = undefined;
    setHasBack(false);
    setIsOpen(true);
  }, []);
  const openWithBack = useCallback((onBack: () => void) => {
    onBackRef.current = onBack;
    setHasBack(true);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    onBackRef.current = undefined;
    setHasBack(false);
    setIsOpen(false);
  }, []);
  const dismiss = useCallback(() => {
    const onBack = onBackRef.current;
    close();
    onBack?.();
  }, [close]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (window.location.pathname.startsWith("/admin")) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onBackRef.current = undefined;
        setHasBack(false);
        setIsOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <CommandPaletteContext.Provider value={{ isOpen, hasBack, open, openWithBack, close, dismiss }}>
      {children}
    </CommandPaletteContext.Provider>
  );
}
