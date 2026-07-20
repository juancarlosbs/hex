import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Waterfall } from "./Waterfall";

afterEach(cleanup);

describe("Waterfall", () => {
  it("shows measured phases and hides null ones", () => {
    render(<Waterfall timing={{ dnsMs: 12, tcpMs: 8, tlsMs: null, ttfbMs: 40, downloadMs: 5, totalMs: 65 }} />);
    expect(screen.getByText(/DNS/)).toBeTruthy();
    expect(screen.getByText(/TTFB/)).toBeTruthy();
    expect(screen.queryByText(/TLS/)).toBeNull();
  });

  it("guards against zero total time (no NaN width)", () => {
    const { container } = render(
      <Waterfall timing={{ dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, downloadMs: 0, totalMs: 0 }} />
    );
    expect(screen.getByText(/DNS/)).toBeTruthy();
    // Bug: 0/0 -> NaN% is invalid CSS; jsdom drops it, leaving width "".
    // Guarded, each bar must resolve to a valid "0%".
    const bars = container.querySelectorAll<HTMLElement>("div.h-full.rounded-full");
    expect(bars.length).toBe(5);
    bars.forEach((bar) => expect(bar.style.width).toBe("0%"));
  });
});
