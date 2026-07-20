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
});
