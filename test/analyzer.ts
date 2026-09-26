import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { defaultCodeAnalyzer } from "../lib/index.ts";

describe("defaultCodeAnalyzer", () => {
  it("includes imports from re-export statements", () => {
    const code = [
      `import thing from "alpha";`,
      `export { otherThing } from "beta";`,
      `export * from "gamma";`,
      `export { thing };`,
    ].join("\n");

    const { error, result } = defaultCodeAnalyzer({ code });

    assert.strictEqual(error, undefined);

    if (error !== undefined) {
      throw error;
    }

    assert.deepStrictEqual(
      result.imports.map((statement) => {
        return statement.value;
      }),
      ["alpha", "beta", "gamma"]
    );

    assert.deepStrictEqual(
      result.imports.map((statement) => {
        return code.substring(statement.range.from, statement.range.to);
      }),
      [`"alpha"`, `"beta"`, `"gamma"`]
    );
  });

  it("handles typescript-only syntax", () => {
    const code = [
      `import thing from "alpha";`,
      `enum Kind { A, B }`,
      `class Holder { constructor(private value: number) {} }`,
      `const checked = { kind: Kind.A } satisfies { kind: Kind };`,
      `export * from "beta";`,
    ].join("\n");

    const { error, result } = defaultCodeAnalyzer({ code });

    assert.strictEqual(error, undefined);

    if (error !== undefined) {
      throw error;
    }

    assert.deepStrictEqual(
      result.imports.map((statement) => {
        return statement.value;
      }),
      ["alpha", "beta"]
    );
  });

  it("ignores exports without a source module", () => {
    const code = [
      `const localValue = 1;`,
      `export { localValue };`,
      `export default localValue;`,
    ].join("\n");

    const { error, result } = defaultCodeAnalyzer({ code });

    assert.strictEqual(error, undefined);

    if (error !== undefined) {
      throw error;
    }

    assert.deepStrictEqual(result.imports, []);
  });
});
