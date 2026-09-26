import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { createEs6DebugServer, defaultImportResolver } from "../lib/index.ts";
import {
  assertOutcomeKind,
  browserFetch,
  createFakeFileSystem,
  fetchImportsOf,
  urlOf
} from "./harness.ts";
import type { TResolveImportPathFunc } from "../lib/index.ts";

// what a browser ends up with when it loads a module from the server and then every module it imports:
// which file each import was read from and what was served
const loadWithImports = async ({
  files,
  entry,
  prefix,
  resolveImportPath
}: {
  files: { [filePath: string]: string },
  entry: string,
  prefix: string,
  resolveImportPath: TResolveImportPathFunc
}) => {
  const fileSystem = createFakeFileSystem({ files });

  const server = createEs6DebugServer({
    scriptRootFolder: "/app/frontend",
    tryReadScriptAsString: fileSystem.tryReadScriptAsString,
    resolveImportPath
  });

  const fetchedEntry = await browserFetch({ server, url: urlOf({ path: entry, prefix }), prefix });
  const fetchedImports = await fetchImportsOf({ server, fetched: fetchedEntry, prefix });

  return fetchedImports.map(({ outcome }, index) => {
    // the entry is read first, then each import once
    const readPath = fileSystem.readPaths()[index + 1];
    return { readPath, outcome };
  });
};

const resolveWithPackages = ({ packages }: { packages: { [specifier: string]: string } }): TResolveImportPathFunc => {
  return async ({ importer, specifier }) => {
    if (Object.hasOwn(packages, specifier)) {
      return { error: undefined, filePath: packages[specifier] };
    }

    return defaultImportResolver({ importer, specifier });
  };
};

describe("imports of served scripts, as a browser loads them", () => {
  const files = {
    "/app/frontend/ui/index.js": [
      `import { a } from "./a.js";`,
      `import { b } from "../../shared/b.js";`,
      `import { lib } from "lib";`,
      `export * from "./sub/d.js";`,
      `export { e } from "../e.js";`,
    ].join("\n"),
    "/app/frontend/ui/a.js": `export const a = "a";`,
    "/app/shared/b.js": `export const b = "b";`,
    "/app/node_modules/lib/index.js": `export const lib = "lib";`,
    "/app/frontend/ui/sub/d.js": `export const d = "d";`,
    "/app/frontend/e.js": `export const e = "e";`,
  };

  const resolveImportPath = resolveWithPackages({ packages: { lib: "/app/node_modules/lib/index.js" } });

  ["", "/production", "/a/b"].forEach((prefix) => {
    it(`loads every import from the file it resolves to, below the prefix ${JSON.stringify(prefix)}`, async () => {
      const loaded = await loadWithImports({ files, entry: "/ui/index.js", prefix, resolveImportPath });

      assert.deepStrictEqual(loaded.map(({ readPath }) => {
        return readPath;
      }), [
        "/app/frontend/ui/a.js",
        "/app/shared/b.js",
        "/app/node_modules/lib/index.js",
        "/app/frontend/ui/sub/d.js",
        "/app/frontend/e.js",
      ]);

      loaded.forEach(({ readPath, outcome }) => {
        const content = files[readPath as keyof typeof files];
        assert.deepStrictEqual(outcome, { kind: "content", contentType: "text/javascript", content });
      });
    });
  });
});

// a file name with a ? is not among them: the server gets the decoded path of a request, where a ? can
// not be told apart from the start of a query
describe("imports of files with unusual names, as a browser loads them", () => {
  const unusualFileNames = [
    { what: "a space", fileName: "with space.js" },
    { what: "a hash", fileName: "chapter#1.js" },
    { what: "a percent sign", fileName: "100%.js" },
    { what: "a double quote", fileName: `say "hi".js` },
    { what: "a backslash", fileName: "back\\slash.js" },
    { what: "a line break", fileName: "line\nbreak.js" },
    { what: "a non-ascii character", fileName: "grüße.js" },
  ];

  unusualFileNames.forEach(({ what, fileName }) => {
    it(`loads an import of a file whose name contains ${what}`, async () => {
      const filePath = `/app/node_modules/odd/${fileName}`;

      const loaded = await loadWithImports({
        files: {
          "/app/frontend/index.js": `import { odd } from "odd";`,
          [filePath]: `export const odd = true;`
        },
        entry: "/index.js",
        prefix: "",
        resolveImportPath: resolveWithPackages({ packages: { odd: filePath } })
      });

      assert.strictEqual(loaded.length, 1);
      assert.strictEqual(loaded[0].readPath, filePath);
      assertOutcomeKind({ outcome: loaded[0].outcome, kind: "content" });
    });
  });
});

describe("defaultImportResolver", () => {
  it("resolves ./ specifiers against the folder of the importer", async () => {
    const result = await defaultImportResolver({ importer: "/app/frontend/index.js", specifier: "./ui/a.js" });

    assert.deepStrictEqual(result, { error: undefined, filePath: "/app/frontend/ui/a.js" });
  });

  it("resolves ../ specifiers against the folder of the importer", async () => {
    const result = await defaultImportResolver({ importer: "/app/frontend/ui/index.js", specifier: "../../shared/b.js" });

    assert.deepStrictEqual(result, { error: undefined, filePath: "/app/shared/b.js" });
  });

  it("reports bare specifiers as an error instead of throwing", async () => {
    const resolveBareSpecifier = () => {
      return defaultImportResolver({ importer: "/app/frontend/index.js", specifier: "lib" });
    };

    assert.doesNotThrow(resolveBareSpecifier);

    const result = await resolveBareSpecifier();

    assert.ok(result.error instanceof Error);
  });
});
