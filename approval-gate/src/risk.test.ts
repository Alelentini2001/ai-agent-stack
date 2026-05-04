import { describe, it, expect } from "vitest";
import { classifyRisk } from "./risk.js";

describe("classifyRisk", () => {
  it("returns low when no labels", () => {
    expect(classifyRisk([])).toBe("low");
  });

  it("returns low for unrecognised labels", () => {
    expect(classifyRisk(["priority:high", "type:bug"])).toBe("low");
  });

  it("returns medium for risk:content", () => {
    expect(classifyRisk(["risk:content"])).toBe("medium");
  });

  it("returns medium for risk:config", () => {
    expect(classifyRisk(["risk:config"])).toBe("medium");
  });

  it("returns high for risk:deploy", () => {
    expect(classifyRisk(["risk:deploy"])).toBe("high");
  });

  it("returns high for risk:schema", () => {
    expect(classifyRisk(["risk:schema"])).toBe("high");
  });

  it("returns high for risk:design", () => {
    expect(classifyRisk(["risk:design"])).toBe("high");
  });

  it("returns high for risk:legal-review", () => {
    expect(classifyRisk(["risk:legal-review"])).toBe("high");
  });

  it("high wins over medium when both present", () => {
    expect(classifyRisk(["risk:content", "risk:deploy"])).toBe("high");
  });

  it("medium wins over low when both present", () => {
    expect(classifyRisk(["risk:content", "type:feature"])).toBe("medium");
  });

  it("returns high immediately on first high label (short-circuits)", () => {
    expect(classifyRisk(["risk:migration", "risk:content", "risk:copy"])).toBe("high");
  });
});
