import { describe, expect, it } from "vitest";
import { groupCorrections } from "./correctionGroups.js";

const item = (module: string, id: string, state = "todo", present = true) => ({
  module,
  id,
  state,
  present,
});

describe("groupCorrections", () => {
  it("puts two transport findings in one task, not two modules", () => {
    const groups = groupCorrections([
      item("fail", "hsts"),
      item("fail", "csp"),
      item("fail", "tls"),
    ]);
    const byCause = Object.fromEntries(groups.map((group) => [group.cause, group]));
    expect(byCause.transport?.items.map((row) => row.id)).toEqual(["hsts", "tls"]);
    expect(byCause.headers?.items.map((row) => row.id)).toEqual(["csp"]);
  });

  it("orders the group with the most open work first", () => {
    const groups = groupCorrections([
      item("fail", "hsts", "fixed"),
      item("fail", "csp", "todo"),
      item("fail", "referrer_policy", "todo"),
      item("fail", "tls", "fixed"),
    ]);
    expect(groups[0]?.cause).toBe("headers");
    expect(groups[0]?.open).toBe(2);
    expect(groups[0]?.fixed).toBe(0);
    expect(groups.find((group) => group.cause === "transport")?.open).toBe(0);
    expect(groups.find((group) => group.cause === "transport")?.fixed).toBe(2);
  });

  it("counts a tracked finding that left the scan as open and vanished", () => {
    const groups = groupCorrections([item("flow", "journey_csrf", "todo", false)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ cause: "journey", open: 1, vanished: 1 });
    expect(groups[0]?.label.fr).toBe("Parcours et formulaires");
  });

  it("gives an unknown control a real cause instead of the module name", () => {
    const groups = groupCorrections([item("fail", "legacy_check")]);
    expect(groups[0]?.cause).toBe("headers");
    expect(groups[0]?.label.fr).toBe("En-têtes de sécurité");
  });
});
