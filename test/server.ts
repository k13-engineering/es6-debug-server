import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { createEs6DebugServer, createReadError } from "../lib/index.ts";

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
