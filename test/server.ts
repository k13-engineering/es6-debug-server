import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { create as createServer } from "../lib/server.ts";
import { createReadError } from "../lib/errors.ts";

describe("createServer", () => {
    it("redirects when scripts are accessed outside the virtual root", async () => {
        const scriptRootFolder = "/my/script/root";
        const virtualRootFolder = "$root";

        const server = createServer({
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

    it("serves scripts when accessed inside the virtual root", async () => {
        const scriptRootFolder = "/my/script/root";
        const virtualRootFolder = "$root";

        const scriptContent = `console.log("hello world");`;

        const server = createServer({
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

        const server = createServer({
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
            createServer({
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
            createServer({
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
            createServer({
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
            createServer({
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
            createServer({
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
