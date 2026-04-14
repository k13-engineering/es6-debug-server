import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { defaultCodeAnalyzer } from "../lib/analyzer.ts";

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
            result.imports.map((statement) => statement.value),
            ["alpha", "beta", "gamma"]
        );

        assert.deepStrictEqual(
            result.imports.map((statement) => {
                return code.substring(statement.range.from, statement.range.to);
            }),
            ['"alpha"', '"beta"', '"gamma"']
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