import { describe, expect, it } from "vitest";
import { completionsFor, decodeKeys, visibleWidth, wrapAnsi } from "../src/hub-tui.js";

describe("decodeKeys", () => {
  it("reads printable text one character at a time", () => {
    expect(decodeKeys("ab")).toEqual([
      { kind: "text", value: "a" },
      { kind: "text", value: "b" },
    ]);
  });

  it("reads the arrow sequences a terminal actually sends", () => {
    expect(decodeKeys("\u001b[A\u001b[B\u001b[C\u001b[D").map((key) => key.kind)).toEqual([
      "up",
      "down",
      "right",
      "left",
    ]);
  });

  it("reads delete, home and end", () => {
    expect(decodeKeys("\u001b[3~\u001b[H\u001b[F").map((key) => key.kind)).toEqual([
      "delete",
      "home",
      "end",
    ]);
  });

  it("distinguishes a lone escape from an interrupted sequence", () => {
    expect(decodeKeys("\u001b").map((key) => key.kind)).toEqual(["escape"]);
    // A partial CSI (a chunk split mid-sequence) must not be typed into the buffer.
    expect(decodeKeys("\u001b[").map((key) => key.kind)).toEqual(["none"]);
  });

  it("maps the control keys to the actions the hub documents", () => {
    expect(decodeKeys("\r\t\u007f\u0003\u0004\u000c\u0015\u0017").map((key) => key.kind)).toEqual([
      "enter",
      "tab",
      "backspace",
      "interrupt",
      "eof",
      "clear",
      "killline",
      "killword",
    ]);
  });

  it("drops control characters it does not handle instead of showing them", () => {
    expect(decodeKeys("\u0002\u001a")).toEqual([]);
  });
});

describe("completionsFor", () => {
  it("lists commands by prefix", () => {
    const commands = completionsFor("/he").map((item) => item.command);
    expect(commands).toEqual(["/help"]);
  });

  it("keeps every match, so a partial prefix is still a menu", () => {
    const commands = completionsFor("/lo").map((item) => item.command);
    expect(commands).toEqual(["/login", "/logout"]);
  });

  it("offers nothing once the command is followed by a space", () => {
    // Typing arguments is not the moment to suggest command names.
    expect(completionsFor("/audit fail")).toEqual([]);
  });

  it("offers nothing for plain text, which goes to the agent", () => {
    expect(completionsFor("explique ce module")).toEqual([]);
  });

  it("is case insensitive, because nobody types the slash command in caps", () => {
    expect(completionsFor("/WHO").map((item) => item.command)).toEqual(["/whoami"]);
  });
});

describe("wrapAnsi", () => {
  const red = "\u001b[31m";
  const reset = "\u001b[0m";

  it("leaves a line that fits untouched", () => {
    expect(wrapAnsi("short", 20)).toEqual(["short"]);
  });

  it("wraps by visible width, not by escape length", () => {
    const line = `${red}abcdef${reset}`;
    expect(visibleWidth(line)).toBe(6);
    expect(wrapAnsi(line, 6)).toEqual([line]);
  });

  it("closes the colour at the break and reopens it on the next line", () => {
    const lines = wrapAnsi(`${red}abcdefgh${reset}`, 4);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`${red}abcd${reset}`);
    expect(lines[1]).toBe(`${red}efgh${reset}`);
  });

  it("keeps the text intact when reassembled", () => {
    const wrapped = wrapAnsi("un deux trois quatre", 7);
    expect(wrapped.join(" ").replace(/\s+/g, " ")).toBe("un deux trois quatre");
  });
});
