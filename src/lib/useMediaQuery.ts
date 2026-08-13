// src/lib/useMediaQuery.ts
import { useEffect, useState } from "react";

/** Breakpoint below which the app switches to the compact layout. */
export const COMPACT_MQ = "(max-width: 899px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    setMatches(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
