import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { XmlTree } from "./XmlTree";

afterEach(cleanup);

describe("XmlTree", () => {
  it("renders element leaf values and copies the bare value", async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<XmlTree xml={`<r xmlns:ns2="urn:example"><ns2:name>Ada</ns2:name></r>`} />);
    expect(screen.getByText("Ada")).toBeTruthy();
    screen.getByRole("button", { name: /copy/i }).click();
    expect(writeText).toHaveBeenCalledWith("Ada");
  });

  it("renders a nested branch's leaf value, proving recursion", () => {
    render(
      <XmlTree
        xml={`<r xmlns:ns2="urn:example"><ns2:person><ns2:name>Ada</ns2:name><ns2:age>36</ns2:age></ns2:person></r>`}
      />
    );
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.getByText("36")).toBeTruthy();
  });
});
