import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { createCodeReplacer } from "./code-replacer.ts";

describe("createCodeReplacer", () => {
  describe("replaceCode", () => {
    it("returns the original code when there are no replacements", () => {
      const { replaceCode } = createCodeReplacer();
      const code = "const x = 1;";
      const result = replaceCode({ code, replacements: [] });
      assert.strictEqual(result, code);
    });

    it("applies a single replacement in the middle", () => {
      const { replaceCode } = createCodeReplacer();
      const code = "hello world";
      // replace "world" (indices 6..11)
      const result = replaceCode({
        code,
        replacements: [{ replacement: "there", range: { from: 6, to: 11 } }]
      });
      assert.strictEqual(result, "hello there");
    });

    it("applies a single replacement at the start", () => {
      const { replaceCode } = createCodeReplacer();
      const code = "hello world";
      // replace "hello" (indices 0..5)
      const result = replaceCode({
        code,
        replacements: [{ replacement: "goodbye", range: { from: 0, to: 5 } }]
      });
      assert.strictEqual(result, "goodbye world");
    });

    it("applies a single replacement at the end", () => {
      const { replaceCode } = createCodeReplacer();
      const code = "hello world";
      // replace "world" (indices 6..11)
      const result = replaceCode({
        code,
        replacements: [{ replacement: "earth", range: { from: 6, to: 11 } }]
      });
      assert.strictEqual(result, "hello earth");
    });

    it("applies multiple replacements in correct order regardless of input order", () => {
      const { replaceCode } = createCodeReplacer();
      const code = "aaa bbb ccc";
      // replace "aaa" (0..3) and "ccc" (8..11), provided in reverse order
      const result = replaceCode({
        code,
        replacements: [
          { replacement: "CCC", range: { from: 8, to: 11 } },
          { replacement: "AAA", range: { from: 0, to: 3 } }
        ]
      });
      assert.strictEqual(result, "AAA bbb CCC");
    });

    it("applies multiple replacements when provided in forward order", () => {
      const { replaceCode } = createCodeReplacer();
      const code = "aaa bbb ccc";
      // provided in forward order, should sort and apply correctly
      const result = replaceCode({
        code,
        replacements: [
          { replacement: "AAA", range: { from: 0, to: 3 } },
          { replacement: "CCC", range: { from: 8, to: 11 } }
        ]
      });
      assert.strictEqual(result, "AAA bbb CCC");
    });

    it("replaces a range with an empty string (deletion)", () => {
      const { replaceCode } = createCodeReplacer();
      const code = "hello world";
      // delete " world" (indices 5..11)
      const result = replaceCode({
        code,
        replacements: [{ replacement: "", range: { from: 5, to: 11 } }]
      });
      assert.strictEqual(result, "hello");
    });

    it("inserts text by using a zero-length range", () => {
      const { replaceCode } = createCodeReplacer();
      const code = "helloworld";
      // insert " " at position 5 (from === to)
      const result = replaceCode({
        code,
        replacements: [{ replacement: " ", range: { from: 5, to: 5 } }]
      });
      assert.strictEqual(result, "hello world");
    });

    it("does not mutate the original replacements array", () => {
      const { replaceCode } = createCodeReplacer();
      const code = "aaa bbb ccc";
      const replacements = [
        { replacement: "AAA", range: { from: 0, to: 3 } },
        { replacement: "CCC", range: { from: 8, to: 11 } }
      ];
      const fromBefore0 = replacements[0]!.range.from;
      const fromBefore1 = replacements[1]!.range.from;
      replaceCode({ code, replacements });
      assert.strictEqual(replacements[0]!.range.from, fromBefore0);
      assert.strictEqual(replacements[1]!.range.from, fromBefore1);
    });

    it("handles three replacements applied in correct positions", () => {
      const { replaceCode } = createCodeReplacer();
      const code = "one two three";
      const result = replaceCode({
        code,
        replacements: [
          { replacement: "1", range: { from: 0, to: 3 } },
          { replacement: "2", range: { from: 4, to: 7 } },
          { replacement: "3", range: { from: 8, to: 13 } }
        ]
      });
      assert.strictEqual(result, "1 2 3");
    });
  });
});
