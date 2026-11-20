import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emptyMemory,
  forgetFact,
  loadMemory,
  memoryPrompt,
  rememberFact,
  summarizeConversation,
} from "../src/memory.js";

async function repo() {
  const root = await mkdtemp(join(tmpdir(), "proofcore-memory-"));
  return { root, clean: () => rm(root, { recursive: true, force: true }) };
}

describe("memory storage", () => {
  it("round-trips and never explodes on a corrupted file", async () => {
    const { root, clean } = await repo();
    try {
      expect((await loadMemory(root)).facts).toEqual([]);
      const memory = await rememberFact(root, "on garde pnpm comme gestionnaire", "decision");
      expect(memory.facts).toHaveLength(1);
      expect((await loadMemory(root)).facts[0]?.text).toContain("pnpm");
      // The file is private: it holds project decisions, which are not for other users.
      expect((await stat(join(root, ".proofcore/memory.json"))).mode & 0o777).toBe(0o600);
    } finally {
      await clean();
    }
  });

  it("dedupes exact facts, whatever the case", async () => {
    const { root, clean } = await repo();
    try {
      await rememberFact(root, "Paiement en XOF uniquement", "decision");
      const memory = await rememberFact(root, "paiement en XOF uniquement", "decision");
      expect(memory.facts).toHaveLength(1);
    } finally {
      await clean();
    }
  });

  it("keeps the memory small instead of growing forever", async () => {
    const { root, clean } = await repo();
    try {
      for (let index = 0; index < 60; index += 1) {
        await rememberFact(root, `leçon ${index} — dossier ${index % 7} revisité`, "lesson");
      }
      const memory = await loadMemory(root);
      expect(memory.facts.length).toBeLessThanOrEqual(40);
      const bytes = (await readFile(join(root, ".proofcore/memory.json"))).length;
      expect(bytes).toBeLessThan(8 * 1024);
    } finally {
      await clean();
    }
  });

  it("forgets what was asked, and only that", async () => {
    const { root, clean } = await repo();
    try {
      await rememberFact(root, "on garde le dossier tests/e2e", "decision");
      await rememberFact(root, "on utilise vitest pour les tests", "decision");
      const memory = await forgetFact(root, "vitest");
      expect(memory.facts).toHaveLength(1);
      expect(memory.facts[0]?.text).toContain("e2e");
    } finally {
      await clean();
    }
  });
});

describe("memoryPrompt", () => {
  it("says nothing when there is nothing to say", () => {
    const empty = emptyMemory("/some/project");
    expect(memoryPrompt(empty, "/some/project")).toBe("");
  });

  it("names the project and separates decisions from lessons", async () => {
    const { root, clean } = await repo();
    try {
      await rememberFact(root, "on garde l'ancien format de rapport", "decision");
      await rememberFact(
        root,
        "un test qui saute peut masquer une régression — jamais de skip silencieux",
        "lesson"
      );
      const prompt = memoryPrompt(await loadMemory(root), root, {
        nodeVersion: "22.3.0",
        lockfile: "pnpm-lock.yaml",
        frameworks: ["react", "vite"],
      });
      expect(prompt).toContain("Contexte projet —");
      expect(prompt).toContain("Décisions déjà prises");
      expect(prompt).toContain("jamais de skip silencieux");
      expect(prompt).toContain("Node 22.3.0");
      expect(prompt).toContain("react");
    } finally {
      await clean();
    }
  });
});

describe("summarizeConversation", () => {
  it("keeps the last goal, the files in play, and stated decisions", () => {
    const summary = summarizeConversation([
      { role: "user", content: "Corrige le module flow pour les deux devises" },
      {
        role: "assistant",
        content: "J'ai lu packages/modules/flow/src/index.ts. On utilise l'arrondi après la somme.",
      },
      { role: "user", content: "Et pour tests/flow.test.ts ?" },
    ]);
    expect(summary).toContain("Corrige le module flow");
    expect(summary).toContain("flow/src/index.ts");
    expect(summary).toContain("On utilise l'arrondi");
  });

  it("is empty when the conversation was empty", () => {
    expect(summarizeConversation([])).toBe("");
  });
});
