import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

import { useMediaQuery } from "./useMediaQuery";

function mockMatchMedia(initial: boolean) {
  let listener: (() => void) | null = null;
  const mql = {
    matches: initial,
    addEventListener: (_: string, fn: () => void) => { listener = fn; },
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
  return {
    set(matches: boolean) {
      mql.matches = matches;
      listener?.();
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useMediaQuery", () => {
  it("returns the initial match state", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery("(max-width: 899px)"));
    expect(result.current).toBe(true);
  });

  it("updates when the media query flips", () => {
    const media = mockMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(max-width: 899px)"));
    expect(result.current).toBe(false);
    act(() => media.set(true));
    expect(result.current).toBe(true);
  });
});
