import { describe, expect, it } from "vitest";
import {
  ANALYSIS_PROFILES,
  CAPABILITIES,
  capabilityById,
  controlFor,
  modulesForTargetType,
  planAnalysis,
  profileById,
} from "../src/index.js";

describe("capability registry", () => {
  it("has unique ids and a complete description for every entry", () => {
    const ids = CAPABILITIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of CAPABILITIES) {
      expect(entry.goal.length).toBeGreaterThan(10);
      expect(entry.fr.title.length).toBeGreaterThan(2);
      expect(entry.fr.description.length).toBeGreaterThan(20);
      expect(entry.en.description.length).toBeGreaterThan(20);
      expect(entry.expectedResult.length).toBeGreaterThan(10);
      expect(entry.proof.description.length).toBeGreaterThan(5);
      expect(entry.limits.length).toBeGreaterThan(0);
      expect(entry.permissions.length).toBeGreaterThan(0);
      expect(entry.version).toBe("1");
    }
  });

  it("only names controls that the control registry actually has", () => {
    for (const entry of CAPABILITIES) {
      for (const controlId of entry.controls) {
        // A capability that advertises a control nobody can report would be a promise
        // the engine cannot keep.
        expect(controlFor(entry.module, controlId), `${entry.id} → ${controlId}`).toBeDefined();
      }
    }
  });

  it("only depends on capabilities that exist", () => {
    for (const entry of CAPABILITIES) {
      for (const dependency of entry.dependencies) {
        expect(capabilityById(dependency), `${entry.id} depends on ${dependency}`).toBeDefined();
      }
    }
  });

  it("builds profiles from real capabilities and modules", () => {
    for (const profile of ANALYSIS_PROFILES) {
      expect(profileById(profile.id)?.id).toBe(profile.id);
      for (const capability of profile.capabilities) {
        const found = capabilityById(capability);
        expect(found, `${profile.id} → ${capability}`).toBeDefined();
        expect(profile.modules).toContain(found?.module);
      }
    }
  });
});

describe("analysis planning", () => {
  it("accepts the modules that apply to a page", () => {
    const plan = planAnalysis({
      targetType: "PAGE",
      requestedModules: ["world", "flow", "fail"],
      surface: "WEB",
    });
    expect(plan.applicableModules).toEqual(["world", "flow", "fail"]);
    expect(plan.unavailable).toHaveLength(0);
    expect(plan.capabilities).toContain("page.flow");
  });

  it("refuses a module with a reason instead of running nothing", () => {
    const plan = planAnalysis({ targetType: "PROJECT", requestedModules: ["flow"] });
    expect(plan.applicableModules).toEqual([]);
    expect(plan.unavailable).toHaveLength(1);
    expect(plan.unavailable[0]?.module).toBe("flow");
    expect(plan.unavailable[0]?.reason).toContain("PROJECT");
  });

  it("refuses an unknown module by name", () => {
    const plan = planAnalysis({ targetType: "PAGE", requestedModules: ["telepathy"] });
    expect(plan.unavailable[0]?.reason).toContain("registre");
  });

  it("knows which modules a target type can offer", () => {
    expect(modulesForTargetType("PROJECT")).toContain("clean");
    expect(modulesForTargetType("API")).toContain("fail");
    expect(modulesForTargetType("LOCAL_ENVIRONMENT")).toEqual(["clean"]);
  });
});
