import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { createEs6DebugServer, defaultImportResolver } from "../lib/index.ts";
import {
  assertOutcomeKind,
  browserFetch,
  createFakeFileSystem,
  describeOutcome,
  fetchImportsOf,
  requestOutcome,
  urlOf
} from "./harness.ts";
import type { TOutcome } from "./harness.ts";
import type { TCodeAnalyzeFunc, TResolveImportPathFunc, TTryReadFunc } from "../lib/index.ts";

// a host with a frontend next to server-side code and secrets, every file here parses as javascript
const files = {
  "/app/frontend/index.js": `import { lib } from "lib";\nexport const main = lib;`,
  "/app/node_modules/lib/index.js": `export const lib = "lib";`,
  "/app/frontend/.env": `API_KEY=frontend-api-key-secret\nDB_PASSWORD=frontend-db-secret\n`,
  "/app/server/config.js": `export const databasePassword = "server-config-secret";`,
  "/app/server/api-keys.json": `["api-key-secret-1", "api-key-secret-2"]\n`,
  "/home/dev/.npmrc": `//registry.npmjs.org/:_authToken=npm-token-secret\n`,
  "/etc/hostname": `build-host-secret\n`,
  "/etc/passwd": `root:x:0:0:root:/root:/bin/bash\n`,
};

const resolveImportPath: TResolveImportPathFunc = async ({ importer, specifier }) => {
  if (specifier === "lib") {
    return { error: undefined, filePath: "/app/node_modules/lib/index.js" };
  }

  return defaultImportResolver({ importer, specifier });
};

const createServerFor = ({
  tryReadScriptAsString,
  analyzeCode
}: {
  tryReadScriptAsString?: TTryReadFunc,
  analyzeCode?: TCodeAnalyzeFunc
} = {}) => {
  const fileSystem = createFakeFileSystem({ files });

  const server = createEs6DebugServer({
    scriptRootFolder: "/app/frontend",
    tryReadScriptAsString: tryReadScriptAsString ?? fileSystem.tryReadScriptAsString,
    analyzeCode,
    resolveImportPath
  });

  return {
    server,
    readPaths: fileSystem.readPaths
  };
};

const assertNotServed = ({ outcome }: { outcome: TOutcome }) => {
  assert.ok(
    outcome.kind !== "content",
    `a file not meant to be served was served: ${describeOutcome({ outcome })}`
  );
  assertOutcomeKind({ outcome, kind: "file-not-found" });
};

describe("security, files that are not meant to be served", () => {
  const notMeantToBeServed = [
    { what: "a dotenv file in the script root", filePath: "/app/frontend/.env" },
    { what: "a script of the server outside the script root", filePath: "/app/server/config.js" },
    { what: "a JSON file holding an array", filePath: "/app/server/api-keys.json" },
    { what: "an npmrc with a registry token", filePath: "/home/dev/.npmrc" },
    { what: "a system file", filePath: "/etc/hostname" },
    { what: "the password file", filePath: "/etc/passwd" },
  ];

  notMeantToBeServed.forEach(({ what, filePath }) => {
    it(`does not serve ${what} requested through the virtual root`, async () => {
      const { server } = createServerFor();

      const outcome = await requestOutcome({ server, uri: `/$root${filePath}` });

      assertNotServed({ outcome });
    });
  });

  it("does not serve a dotenv file in the script root requested next to the scripts", async () => {
    const { server } = createServerFor();

    const { outcome } = await browserFetch({ server, url: urlOf({ path: "/.env" }), prefix: "" });

    assertNotServed({ outcome });
  });

  it("does not serve a script of the server even after serving the frontend", async () => {
    const { server } = createServerFor();

    const entry = await browserFetch({ server, url: urlOf({ path: "/index.js" }), prefix: "" });
    await fetchImportsOf({ server, fetched: entry, prefix: "" });

    const outcome = await requestOutcome({ server, uri: "/$root/app/server/config.js" });

    assertNotServed({ outcome });
  });

  // the counterpart of the above, what a frontend imports from outside the script root must still load
  it("serves a module outside the script root that a served script imports", async () => {
    const { server } = createServerFor();

    const entry = await browserFetch({ server, url: urlOf({ path: "/index.js" }), prefix: "" });
    const [imported] = await fetchImportsOf({ server, fetched: entry, prefix: "" });

    assert.deepStrictEqual(imported.outcome, {
      kind: "content",
      contentType: "text/javascript",
      content: files["/app/node_modules/lib/index.js"]
    });
  });

  it("serves the files in the script root that isScriptFile takes for scripts", async () => {
    const fileSystem = createFakeFileSystem({
      files: {
        "/app/frontend/custom.es": `export const custom = true;`,
        "/app/frontend/index.js": `export const main = true;`
      }
    });

    const server = createEs6DebugServer({
      scriptRootFolder: "/app/frontend",
      isScriptFile: ({ filePath }) => {
        return filePath.endsWith(".es");
      },
      tryReadScriptAsString: fileSystem.tryReadScriptAsString
    });

    const custom = await requestOutcome({ server, uri: "/$root/app/frontend/custom.es" });
    const plain = await requestOutcome({ server, uri: "/$root/app/frontend/index.js" });

    assertOutcomeKind({ outcome: custom, kind: "content" });
    assertOutcomeKind({ outcome: plain, kind: "file-not-found" });
  });

  it("rejects a uri with a null byte, which could cut off an extension check behind it", async () => {
    const { server, readPaths } = createServerFor();

    const outcome = await requestOutcome({ server, uri: "/$root/app/frontend/.env\u0000.js" });

    assertOutcomeKind({ outcome, kind: "rejected" });
    assert.deepStrictEqual(readPaths(), []);
  });
});

describe("security, path traversal", () => {
  const traversals = [
    "/../server/config.js",
    "/../../etc/passwd",
    "/ui/../../server/config.js",
    "/$root/app/frontend/../server/config.js",
    "/$root/app/frontend/../../etc/passwd",
    "/$root/../etc/passwd",
    "/$root/..",
    "/index.js/../../server/config.js",
    "/$root/app/frontend/..\\server\\config.js",
    "/..\\server\\config.js",
  ];

  traversals.forEach((uri) => {
    it(`rejects ${JSON.stringify(uri)} without reading anything`, async () => {
      const { server, readPaths } = createServerFor();

      const outcome = await requestOutcome({ server, uri });

      assertOutcomeKind({ outcome, kind: "rejected" });
      assert.deepStrictEqual(readPaths(), []);
    });
  });

  it("redirects only to locations below the virtual root", async () => {
    const { server } = createServerFor();

    const uris = ["/", "/index.js", "/$root", "/$rootless/index.js", "/ui/%2e%2e/index.js", "/ui/.../index.js"];

    const outcomes = await Promise.all(uris.map((uri) => {
      return requestOutcome({ server, uri });
    }));

    outcomes.forEach((outcome) => {
      assertOutcomeKind({ outcome, kind: "redirect" });
      const { uri } = outcome as { uri: string };
      assert.ok(uri.startsWith("/$root/app/frontend/"), `redirected outside the script root to "${uri}"`);
    });
  });
});

describe("security, a request never takes the server down", () => {
  it("answers with an internal error for a bare import the default resolver does not support", async () => {
    const fileSystem = createFakeFileSystem({ files: { "/app/frontend/index.js": `import "lib";` } });

    const server = createEs6DebugServer({
      scriptRootFolder: "/app/frontend",
      tryReadScriptAsString: fileSystem.tryReadScriptAsString
    });

    const outcome = await requestOutcome({ server, uri: "/$root/app/frontend/index.js" });

    assertOutcomeKind({ outcome, kind: "internal-error" });
  });

  it("answers with an internal error when reading the script throws", async () => {
    const { server } = createServerFor({
      tryReadScriptAsString: async () => {
        throw Error("disk on fire");
      }
    });

    const outcome = await requestOutcome({ server, uri: "/$root/app/frontend/index.js" });

    assertOutcomeKind({ outcome, kind: "internal-error" });
  });

  it("answers with an internal error when analyzing the code throws", async () => {
    const { server } = createServerFor({
      analyzeCode: () => {
        throw Error("analyzer bug");
      }
    });

    const outcome = await requestOutcome({ server, uri: "/$root/app/frontend/index.js" });

    assertOutcomeKind({ outcome, kind: "internal-error" });
  });
});
