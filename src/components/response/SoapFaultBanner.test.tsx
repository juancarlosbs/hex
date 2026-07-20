import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SoapFaultBanner } from "./SoapFaultBanner";

afterEach(cleanup);

describe("SoapFaultBanner", () => {
  it("shows the fault code and reason with error styling", () => {
    render(
      <SoapFaultBanner fault={{ code: "soap:Client", reason: "Invalid value", detail: null, actor: null }} />
    );
    expect(screen.getByText(/soap:Client/)).toBeTruthy();
    expect(screen.getByText("Invalid value")).toBeTruthy();
    const code = screen.getByText(/soap:Client/);
    expect(code.className).toContain("text-status-5xx");
  });

  it("shows the detail when present", () => {
    render(
      <SoapFaultBanner
        fault={{ code: "soap:Server", reason: "Boom", detail: "stack trace here", actor: null }}
      />
    );
    expect(screen.getByText("stack trace here")).toBeTruthy();
  });
});
