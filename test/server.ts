import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { createEs6DebugServer, createReadError, defaultImportResolver } from "../lib/index.ts";
import {
  allCausesOf,
  assertOutcomeKind,
  createFakeFileSystem,
  createGate,
  requestOutcome,
  settle
} from "./harness.ts";
import type { TTryReadFunc, TResolveImportPathFunc, TCodeAnalyzeFunc } from "../lib/index.ts";

type TRedirect = { uri: string, relativeUri: string };

// the redirect a request outside the virtual root is answered with
const redirectOf = async ({ uri }: { uri: string }): Promise<TRedirect> => {
  const server = createEs6DebugServer({
    scriptRootFolder: "/my/script/root",
    virtualRootFolder: "$root",
    tryReadScriptAsString: async () => {
      throw Error("should not be called");
    }
  });

  let redirects: TRedirect[] = [];

  await server.handleRequest({
    uri,

    handleContent: () => {
      assert.fail("should not be called");
    },

    handleFileNotFound: () => {
      assert.fail("should not be called");
    },

    handleInternalError: () => {
      assert.fail("should not be called");
    },

    handleRedirect: (redirect) => {
      redirects = [...redirects, redirect];
    }
  });

  assert.strictEqual(redirects.length, 1);
  return redirects[0];
};

describe("createServer", () => {
  it("redirects when scripts are accessed outside the virtual root", async () => {
    const scriptRootFolder = "/my/script/root";
    const virtualRootFolder = "$root";

    const server = createEs6DebugServer({
      scriptRootFolder,
      virtualRootFolder,
      tryReadScriptAsString: async () => {
        throw Error("should not be called");
      }
    });

    await server.handleRequest({
      uri: "/ui/index.js",

      handleContent: () => {
        assert.fail("should not be called");
      },

      handleFileNotFound: () => {
        assert.fail("should not be called");
      },

      handleInternalError: () => {
        assert.fail("should not be called");
      },

      handleRedirect: ({ uri }) => {
        assert.strictEqual(uri, `/${virtualRootFolder}${scriptRootFolder}/ui/index.js`);
      }
    });
  });

  it("offers the redirect relative to the requested uri as well", async () => {
    const cases = [
      { uri: "/index.js", relativeUri: "./$root/my/script/root/index.js" },
      { uri: "/ui/index.js", relativeUri: "../$root/my/script/root/ui/index.js" },
      { uri: "/ui/pages/index.js", relativeUri: "../../$root/my/script/root/ui/pages/index.js" }
    ];

    const redirects = await Promise.all(cases.map(({ uri }) => {
      return redirectOf({ uri });
    }));

    assert.deepStrictEqual(redirects, cases.map(({ uri, relativeUri }) => {
      // the absolute one is unchanged, so existing callers keep working
      return { uri: `/$root/my/script/root${uri}`, relativeUri };
    }));
  });

  it("the relative redirect leads to the absolute one below any prefix only the client sees", async () => {
    const prefixes = ["", "/production", "/a/b"];
    const uris = ["/index.js", "/ui/index.js", "/ui/pages/index.js"];

    await Promise.all(prefixes.flatMap((prefix) => {
      return uris.map(async (uri) => {
        const redirect = await redirectOf({ uri });

        // what a browser does with a relative Location: resolve it against the URL it requested
        const landed = new URL(redirect.relativeUri, `http://localhost:8080${prefix}${uri}`);

        assert.strictEqual(landed.pathname, `${prefix}${redirect.uri}`);
      });
    }));
  });

  it("counts only the path of the requested uri towards the relative redirect", async () => {
    const redirect = await redirectOf({ uri: "/ui/index.js?v=1&from=a/b/c" });

    assert.strictEqual(redirect.relativeUri, "../$root/my/script/root/ui/index.js?v=1&from=a/b/c");
  });

  it("serves scripts when accessed inside the virtual root", async () => {
    const scriptRootFolder = "/my/script/root";
    const virtualRootFolder = "$root";

    const scriptContent = `console.log("hello world");`;

    const server = createEs6DebugServer({
      scriptRootFolder,
      virtualRootFolder,
      tryReadScriptAsString: async ({ filePath }) => {
        assert.strictEqual(filePath, `${scriptRootFolder}/ui/index.js`);
        return {
          error: undefined,
          content: scriptContent
        };
      }
    });

    await new Promise<void>((resolve, reject) => {
      void server.handleRequest({
        uri: `/${virtualRootFolder}${scriptRootFolder}/ui/index.js`,

        handleContent: ({ contentType, content }) => {
          try {
            assert.strictEqual(contentType, "text/javascript");
            assert.strictEqual(content, scriptContent);
            resolve();
          } catch (error) {
            reject(error);
          }
        },

        handleFileNotFound: () => {
          reject(Error("should not be called"));
        },

        handleInternalError: () => {
          reject(Error("should not be called"));
        },

        handleRedirect: () => {
          reject(Error("should not be called"));
        }
      }).catch(reject);
    });
  });

  it("fails when the script file cannot be found", async () => {
    const scriptRootFolder = "/my/script/root";
    const virtualRootFolder = "$root";

    const server = createEs6DebugServer({
      scriptRootFolder,
      virtualRootFolder,
      tryReadScriptAsString: async ({ filePath }) => {
        return {
          error: createReadError({
            code: "FILE_NOT_FOUND",
            message: `file "${filePath}" not found`
          })
        };
      }
    });

    await new Promise<void>((resolve, reject) => {
      void server.handleRequest({
        uri: `/${virtualRootFolder}${scriptRootFolder}/ui/index.js`,

        handleContent: () => {
          reject(Error("should not be called"));
        },

        handleFileNotFound: () => {
          resolve();
        },

        handleInternalError: () => {
          reject(Error("should not be called"));
        },

        handleRedirect: () => {
          reject(Error("should not be called"));
        }
      }).catch(reject);
    });
  });

  it("throws on a non-absolute script root folder", () => {
    assert.throws(() => {
      createEs6DebugServer({
        scriptRootFolder: "my/script/root",
        virtualRootFolder: "$root",
        tryReadScriptAsString: async () => {
          throw Error("should not be called");
        }
      });
    }, (error: unknown) => {
      return error instanceof Error && error.message === "scriptRootFolder must start with /";
    });
  });

  it("throws on a trailing slash in the script root folder", () => {
    assert.throws(() => {
      createEs6DebugServer({
        scriptRootFolder: "/my/script/root/",
        virtualRootFolder: "$root",
        tryReadScriptAsString: async () => {
          throw Error("should not be called");
        }
      });
    }, (error: unknown) => {
      return error instanceof Error && error.message === "scriptRootFolder must not end with /";
    });
  });

  it("throws when the script root folder contains '.'", () => {
    assert.throws(() => {
      createEs6DebugServer({
        scriptRootFolder: "/my/./script/root",
        virtualRootFolder: "$root",
        tryReadScriptAsString: async () => {
          throw Error("should not be called");
        }
      });
    }, (error: unknown) => {
      return error instanceof Error && error.message === "scriptRootFolder must not contain .";
    });
  });

  it("throws when the script root folder contains '..'", () => {
    assert.throws(() => {
      createEs6DebugServer({
        scriptRootFolder: "/my/../script/root",
        virtualRootFolder: "$root",
        tryReadScriptAsString: async () => {
          throw Error("should not be called");
        }
      });
    }, (error: unknown) => {
      return error instanceof Error && error.message === "scriptRootFolder must not contain ..";
    });
  });

  it("throws when the script root folder contains double slashes", () => {
    assert.throws(() => {
      createEs6DebugServer({
        scriptRootFolder: "/my//script/root",
        virtualRootFolder: "$root",
        tryReadScriptAsString: async () => {
          throw Error("should not be called");
        }
      });
    }, (error: unknown) => {
      return error instanceof Error && error.message === "scriptRootFolder must not contain //";
    });
  });
});

const scriptRootFolder = "/app/frontend";

const createServerFor = ({
  files = {},
  tryReadScriptAsString,
  resolveImportPath,
  analyzeCode
}: {
  files?: { [filePath: string]: string },
  tryReadScriptAsString?: TTryReadFunc,
  resolveImportPath?: TResolveImportPathFunc,
  analyzeCode?: TCodeAnalyzeFunc
}) => {
  const fileSystem = createFakeFileSystem({ files });

  const server = createEs6DebugServer({
    scriptRootFolder,
    tryReadScriptAsString: tryReadScriptAsString ?? fileSystem.tryReadScriptAsString,
    resolveImportPath,
    analyzeCode
  });

  return {
    server,
    readPaths: fileSystem.readPaths
  };
};

describe("createServer, serving scripts", () => {
  it("serves a script with relative imports unchanged", async () => {
    const code = [
      `import { a } from "./a.js";`,
      `import { b } from "../shared/b.js";`,
      `export * from "./sub/c.js";`,
    ].join("\n");

    const { server } = createServerFor({ files: { "/app/frontend/index.js": code } });

    const outcome = await requestOutcome({ server, uri: "/$root/app/frontend/index.js" });

    assert.deepStrictEqual(outcome, { kind: "content", contentType: "text/javascript", content: code });
  });

  it("rewrites imports the resolver resolves to absolute paths into relative ones", async () => {
    const { server } = createServerFor({
      files: {
        "/app/frontend/ui/index.js": `import { lib } from "lib";\nexport * from "lib/sub";`
      },
      resolveImportPath: async ({ specifier }) => {
        return { error: undefined, filePath: `/app/node_modules/${specifier}/index.js` };
      }
    });

    const outcome = await requestOutcome({ server, uri: "/$root/app/frontend/ui/index.js" });

    assertOutcomeKind({ outcome, kind: "content" });
    assert.strictEqual(
      (outcome as { content: string }).content,
      `import { lib } from "../../node_modules/lib/index.js";\nexport * from "../../node_modules/lib/sub/index.js";`
    );
  });

  it("uses the virtual root folder it is given", async () => {
    const fileSystem = createFakeFileSystem({ files: { "/app/frontend/index.js": `export const a = 1;` } });

    const server = createEs6DebugServer({
      scriptRootFolder,
      virtualRootFolder: "@fs",
      tryReadScriptAsString: fileSystem.tryReadScriptAsString
    });

    const redirect = await requestOutcome({ server, uri: "/index.js" });
    const served = await requestOutcome({ server, uri: "/@fs/app/frontend/index.js" });

    assert.deepStrictEqual(redirect, {
      kind: "redirect",
      uri: "/@fs/app/frontend/index.js",
      relativeUri: "./@fs/app/frontend/index.js"
    });
    assertOutcomeKind({ outcome: served, kind: "content" });
  });

  it("redirects the root of the script root folder", async () => {
    const { server } = createServerFor({});

    const outcome = await requestOutcome({ server, uri: "/" });

    assert.deepStrictEqual(outcome, {
      kind: "redirect",
      uri: "/$root/app/frontend/",
      relativeUri: "./$root/app/frontend/"
    });
  });
});

describe("createServer, failing requests", () => {
  it("answers with an internal error when the script can not be read", async () => {
    const readError = createReadError({ code: "IO_ERROR", message: "permission denied" });

    const { server } = createServerFor({
      tryReadScriptAsString: async () => {
        return { error: readError };
      }
    });

    const outcome = await requestOutcome({ server, uri: "/$root/app/frontend/index.js" });

    assertOutcomeKind({ outcome, kind: "internal-error" });
    assert.ok(allCausesOf({ error: (outcome as { error: Error }).error }).includes(readError));
  });

  it("answers with an internal error when the read error carries no error code", async () => {
    const { server } = createServerFor({
      tryReadScriptAsString: async () => {
        return { error: Error("something went wrong") };
      }
    });

    const outcome = await requestOutcome({ server, uri: "/$root/app/frontend/index.js" });

    assertOutcomeKind({ outcome, kind: "internal-error" });
  });

  it("answers with an internal error when the script has a syntax error", async () => {
    const { server } = createServerFor({ files: { "/app/frontend/index.js": `import { from "./a.js";` } });

    const outcome = await requestOutcome({ server, uri: "/$root/app/frontend/index.js" });

    assertOutcomeKind({ outcome, kind: "internal-error" });
  });

  it("answers with an internal error when an import can not be resolved", async () => {
    const resolveError = Error("no such package");

    const { server } = createServerFor({
      files: { "/app/frontend/index.js": `import "missing";` },
      resolveImportPath: async () => {
        return { error: resolveError };
      }
    });

    const outcome = await requestOutcome({ server, uri: "/$root/app/frontend/index.js" });

    assertOutcomeKind({ outcome, kind: "internal-error" });
    assert.ok(allCausesOf({ error: (outcome as { error: Error }).error }).includes(resolveError));
  });
});

describe("createServer, canceling requests", () => {
  const answersOf = async ({ server, uri, whileRunning }: {
    server: ReturnType<typeof createEs6DebugServer>,
    uri: string,
    whileRunning: (args: { cancel: () => void }) => Promise<void>
  }) => {
    let answers: string[] = [];

    const record = ({ answer }: { answer: string }) => {
      answers = [...answers, answer];
    };

    const { cancel } = await server.handleRequest({
      uri,
      handleContent: () => {
        record({ answer: "content" });
      },
      handleRedirect: () => {
        record({ answer: "redirect" });
      },
      handleFileNotFound: () => {
        record({ answer: "file-not-found" });
      },
      handleInternalError: () => {
        record({ answer: "internal-error" });
      }
    });

    await whileRunning({ cancel });
    await settle();

    return answers;
  };

  it("does not answer a request that is canceled while the script is read", async () => {
    const readGate = createGate();

    const { server } = createServerFor({
      tryReadScriptAsString: async () => {
        await readGate.opened;
        return { error: undefined, content: `export const a = 1;` };
      }
    });

    const answers = await answersOf({
      server,
      uri: "/$root/app/frontend/index.js",
      whileRunning: async ({ cancel }) => {
        cancel();
        readGate.open();
      }
    });

    assert.deepStrictEqual(answers, []);
  });

  it("does not answer a request that is canceled while the script can not be read", async () => {
    const readGate = createGate();

    const { server } = createServerFor({
      tryReadScriptAsString: async () => {
        await readGate.opened;
        return { error: createReadError({ code: "FILE_NOT_FOUND", message: "not found" }) };
      }
    });

    const answers = await answersOf({
      server,
      uri: "/$root/app/frontend/index.js",
      whileRunning: async ({ cancel }) => {
        cancel();
        readGate.open();
      }
    });

    assert.deepStrictEqual(answers, []);
  });

  it("does not answer a request that is canceled while its imports are resolved", async () => {
    const resolveStarted = createGate();
    const resolveGate = createGate();

    const { server } = createServerFor({
      files: { "/app/frontend/index.js": `import "./a.js";` },
      resolveImportPath: async (args) => {
        resolveStarted.open();
        await resolveGate.opened;
        return defaultImportResolver(args);
      }
    });

    const answers = await answersOf({
      server,
      uri: "/$root/app/frontend/index.js",
      whileRunning: async ({ cancel }) => {
        await resolveStarted.opened;
        cancel();
        resolveGate.open();
      }
    });

    assert.deepStrictEqual(answers, []);
  });

  it("canceling a request after its redirect has no further effect", async () => {
    const { server } = createServerFor({});

    const answers = await answersOf({
      server,
      uri: "/index.js",
      whileRunning: async ({ cancel }) => {
        cancel();
      }
    });

    assert.deepStrictEqual(answers, ["redirect"]);
  });
});

describe("createServer, malformed uris", () => {
  const malformedUris = [
    "index.js",
    "",
    "//index.js",
    "//example.com/index.js",
    "/ui//index.js",
    "/$root//app/frontend/index.js",
    "/$root/app//frontend/index.js",
    "/../index.js",
    "/ui/../index.js",
    "/$root/../app/frontend/index.js",
    "/$root/app/frontend/../frontend/index.js",
    "/$root/app/frontend/..",
  ];

  malformedUris.forEach((uri) => {
    it(`rejects ${JSON.stringify(uri)} without reading anything`, async () => {
      const { server, readPaths } = createServerFor({ files: { "/app/frontend/index.js": `export const a = 1;` } });

      const outcome = await requestOutcome({ server, uri });

      assertOutcomeKind({ outcome, kind: "rejected" });
      assert.deepStrictEqual(readPaths(), []);
    });
  });
});

describe("createServer, query strings", () => {
  it.skip("redirects a uri whose query contains a url", async () => {
    const { server } = createServerFor({});

    const outcome = await requestOutcome({ server, uri: "/ui/index.js?next=https://example.com/" });

    assert.deepStrictEqual(outcome, {
      kind: "redirect",
      uri: "/$root/app/frontend/ui/index.js?next=https://example.com/",
      relativeUri: "../$root/app/frontend/ui/index.js?next=https://example.com/"
    });
  });

  it.skip("redirects a uri whose query contains a relative path", async () => {
    const { server } = createServerFor({});

    const outcome = await requestOutcome({ server, uri: "/ui/index.js?from=a/../b" });

    assert.deepStrictEqual(outcome, {
      kind: "redirect",
      uri: "/$root/app/frontend/ui/index.js?from=a/../b",
      relativeUri: "../$root/app/frontend/ui/index.js?from=a/../b"
    });
  });

  it.skip("reads the script without the query of the uri", async () => {
    const { server, readPaths } = createServerFor({ files: { "/app/frontend/index.js": `export const a = 1;` } });

    const outcome = await requestOutcome({ server, uri: "/$root/app/frontend/index.js?v=1" });

    assertOutcomeKind({ outcome, kind: "content" });
    assert.deepStrictEqual(readPaths(), ["/app/frontend/index.js"]);
  });
});

describe("createServer, configuration", () => {
  // each of these either never matches a request or redirects into a loop or to another host
  const brokenVirtualRootFolders = ["", ".", "..", "/", "root/"];

  brokenVirtualRootFolders.forEach((virtualRootFolder) => {
    it.skip(`throws on the virtual root folder ${JSON.stringify(virtualRootFolder)}`, () => {
      assert.throws(() => {
        createEs6DebugServer({
          scriptRootFolder,
          virtualRootFolder,
          tryReadScriptAsString: async () => {
            throw Error("should not be called");
          }
        });
      });
    });
  });
});
