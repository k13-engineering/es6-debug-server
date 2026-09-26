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

const importsOf = ({ code }: { code: string }) => {
  const { error, result } = defaultCodeAnalyzer({ code });

  if (error !== undefined) {
    throw error;
  }

  return result.imports.map((statement) => {
    return {
      value: statement.value,
      source: code.substring(statement.range.from, statement.range.to)
    };
  });
};

const valuesOf = ({ code }: { code: string }) => {
  return importsOf({ code }).map(({ value }) => {
    return value;
  });
};

describe("defaultCodeAnalyzer, the forms of imports", () => {
  it("returns an error for code that does not parse", () => {
    const { error } = defaultCodeAnalyzer({ code: `import { from "./a.js";` });

    assert.ok(error instanceof Error);
  });

  it("includes side effect, namespace, default and named imports", () => {
    const code = [
      `import "./a.js";`,
      `import * as b from "./b.js";`,
      `import c, { d } from "./c.js";`,
      `import { e as f } from "./e.js";`,
    ].join("\n");

    assert.deepStrictEqual(valuesOf({ code }), ["./a.js", "./b.js", "./c.js", "./e.js"]);
  });

  it("includes re-exports of namespaces and defaults", () => {
    const code = [
      `export * as a from "./a.js";`,
      `export { default } from "./b.js";`,
      `export { c as default } from "./c.js";`,
    ].join("\n");

    assert.deepStrictEqual(valuesOf({ code }), ["./a.js", "./b.js", "./c.js"]);
  });

  it("includes imports with import attributes", () => {
    const code = `import data from "./data.json" with { type: "json" };`;

    assert.deepStrictEqual(importsOf({ code }), [{ value: "./data.json", source: `"./data.json"` }]);
  });

  it("reports the range of the whole string literal, whatever its quotes and escapes", () => {
    const code = [
      `import a from './a.js';`,
      `import b from "./\\u0062.js";`,
    ].join("\n");

    assert.deepStrictEqual(importsOf({ code }), [
      { value: "./a.js", source: `'./a.js'` },
      { value: "./b.js", source: `"./\\u0062.js"` },
    ]);
  });

  it.skip("includes dynamic imports with a string literal specifier", () => {
    const code = [
      `const lazy = await import("./lazy.js");`,
      `button.onclick = () => import("lib").then((lib) => lib.run());`,
    ].join("\n");

    assert.deepStrictEqual(importsOf({ code }), [
      { value: "./lazy.js", source: `"./lazy.js"` },
      { value: "lib", source: `"lib"` },
    ]);
  });

  it("ignores dynamic imports whose specifier is computed", () => {
    const code = [
      `const name = "./a.js";`,
      `await import(name);`,
      `await import(\`./\${name}\`);`,
    ].join("\n");

    assert.deepStrictEqual(valuesOf({ code }), []);
  });

  it("ignores text that only looks like an import", () => {
    const code = [
      `// import "./comment.js";`,
      `/* export * from "./block-comment.js"; */`,
      `const a = 'import "./string.js";';`,
      `const b = \`export { x } from "./template.js";\`;`,
      `const c = import.meta.url;`,
    ].join("\n");

    assert.deepStrictEqual(valuesOf({ code }), []);
  });

  it("handles a hashbang and top-level await", () => {
    const code = [
      `#!/usr/bin/env node`,
      `import { a } from "./a.js";`,
      `await a();`,
    ].join("\n");

    assert.deepStrictEqual(valuesOf({ code }), ["./a.js"]);
  });

  it("reports the same specifier each time it is imported", () => {
    const code = [
      `import { a } from "./a.js";`,
      `import { b } from "./a.js";`,
    ].join("\n");

    assert.deepStrictEqual(valuesOf({ code }), ["./a.js", "./a.js"]);
  });
});
