import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroLockup, Wordmark } from "./Logo.js";

describe("PROOFCORE wordmark", () => {
  it("uses the geometric P as the first letter when the mark is visible", () => {
    const html = renderToStaticMarkup(createElement(Wordmark, { showMark: true }));
    expect(html).toContain(">ROOFCORE</span>");
    expect(html).not.toContain("PPROOFCORE");
    expect(html).not.toContain("PROOFSTACK");
  });

  it("renders the complete name when the mark is hidden", () => {
    const html = renderToStaticMarkup(createElement(Wordmark, { showMark: false }));
    expect(html).toContain(">PROOFCORE</span>");
  });

  it("uses the matching ROOFCORE letter sequence in the animated hero", () => {
    const html = renderToStaticMarkup(createElement(HeroLockup));
    expect(html).toContain(">ROOFCORE</span>");
    expect(html).not.toContain("ROOFSTACK");
    expect(html).not.toContain("PPROOFCORE");
  });
});
