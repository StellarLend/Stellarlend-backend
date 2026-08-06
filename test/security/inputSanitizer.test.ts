import { describe, it, expect } from "vitest";

import { sanitiseString, sanitiseRecord } from "../../src/lib/security/inputSanitizer.js";

describe("sanitiseString", () => {
  it("removes zero-width characters (U+200B)", () => {
    expect(sanitiseString("alice\u200Bbob")).toBe("alicebob");
  });

  it("removes bidi override marks (U+202E)", () => {
    expect(sanitiseString("\u202Eabc")).toBe("abc");
  });

  it("NFC-normalizes decomposed characters without loss", () => {
    const composed = "é"; // single precomposed codepoint
    const decomposed = "e\u0301"; // 'e' + combining acute accent
    expect(sanitiseString(decomposed)).toBe(composed);
  });

  it("preserves emoji", () => {
    expect(sanitiseString("hello 👋 world 🌍")).toBe("hello 👋 world 🌍");
  });

  it("preserves accented Latin and CJK text", () => {
    expect(sanitiseString("naïve café 日本語")).toBe("naïve café 日本語");
  });

  it("strips controls from mixed-script text but keeps legitimate glyphs", () => {
    expect(sanitiseString("English 日本語 \u200B zero")).toBe("English 日本語  zero");
  });

  it("returns empty string unchanged", () => {
    expect(sanitiseString("")).toBe("");
  });
});

describe("sanitiseRecord", () => {
  it("sanitizes string fields recursively in nested objects and arrays", () => {
    const rec = {
      name: "x\u200By",
      nested: { label: "z\u202Ew" },
      list: ["m\u200Bn", 1, true, null],
    };
    expect(sanitiseRecord(rec)).toEqual({
      name: "xy",
      nested: { label: "zw" },
      list: ["mn", 1, true, null],
    });
  });

  it("leaves non-string scalar values untouched", () => {
    expect(sanitiseRecord(42)).toBe(42);
    expect(sanitiseRecord("a\u200Bb")).toBe("ab");
    expect(sanitiseRecord(null)).toBe(null);
    expect(sanitiseRecord(false)).toBe(false);
  });

  it("does not mutate the original object", () => {
    const original = { bio: "hi\u200Bthere" };
    const cleaned = sanitiseRecord(original);
    expect(original.bio).toBe("hi\u200Bthere");
    expect((cleaned as { bio: string }).bio).toBe("hithere");
  });
});
