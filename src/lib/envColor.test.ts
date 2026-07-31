import { describe, expect, it } from "vitest";
import { envDotClass } from "./envColor";

describe("envDotClass", () => {
  it("maps the three seeded environment names", () => {
    expect(envDotClass("Development")).toBe("bg-env-development");
    expect(envDotClass("Staging")).toBe("bg-env-staging");
    expect(envDotClass("Production")).toBe("bg-env-production");
  });

  it("falls back to neutral for unknown names", () => {
    expect(envDotClass("QA")).toBe("bg-env-neutral");
  });
});
