// @ts-ignore
import assert from "node:assert";
import { ITestGroup } from "../../../ya-test-library/lib/types.ts";
import { ETryReadErrorCode, create as createServer } from "../../lib/server.ts";

const serverTestGroup: ITestGroup = {
    tests: {
        "should redirect when scripts are accessed outside virtual root": () => {

            const scriptRootFolder = "/my/script/root";
            const virtualRootFolder = "$root";

            const server = createServer({
                scriptRootFolder,
                virtualRootFolder,
                tryReadScriptAsString: () => {
                    throw Error("should not be called");
                }
            });

            server.handleRequest({
                uri: "/ui/index.js",

                handleContent: () => {
                    throw Error("should not be called");
                },

                handleFileNotFound: () => {
                    throw Error("should not be called");
                },

                handleInternalError: ({ error }) => {
                    throw Error("should not be called");
                },

                handleRedirect: ({ uri }) => {
                    assert.strictEqual(uri, `/${virtualRootFolder}${scriptRootFolder}/ui/index.js`);
                }
            });
        },

        "should serve script when accessed inside virtual root": () => {

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

            return new Promise((resolve) => {
                server.handleRequest({
                    uri: `/${virtualRootFolder}${scriptRootFolder}/ui/index.js`,

                    handleContent: ({ contentType, content }) => {
                        assert.strictEqual(contentType, "text/javascript");
                        assert.strictEqual(content, scriptContent);
                        resolve();
                    },

                    handleFileNotFound: () => {
                        throw Error("should not be called");
                    },

                    handleInternalError: ({ error }) => {
                        throw Error("should not be called");
                    },

                    handleRedirect: ({ uri }) => {
                        assert.strictEqual(uri, `/${virtualRootFolder}${scriptRootFolder}/ui/index.js`);
                    }
                });
            });
        },

        "should fail when script file cannot be found": () => {

            const scriptRootFolder = "/my/script/root";
            const virtualRootFolder = "$root";

            const server = createServer({
                scriptRootFolder,
                virtualRootFolder,
                tryReadScriptAsString: async ({ filePath }) => {
                    return {
                        error: {
                            code: ETryReadErrorCode.FILE_NOT_FOUND,
                            message: "file not found"
                        },
                    };
                }
            });

            return new Promise((resolve) => {
                server.handleRequest({
                    uri: `/${virtualRootFolder}${scriptRootFolder}/ui/index.js`,

                    handleContent: ({ contentType, content }) => {
                        throw Error("should not be called");
                    },

                    handleFileNotFound: () => {
                        resolve();
                    },

                    handleInternalError: ({ error }) => {
                        throw Error("should not be called");
                    },

                    handleRedirect: ({ uri }) => {
                        throw Error("should not be called");
                    }
                });
            });
        },

        "should throw on non-absolute script root folder": () => {
            assert.throws(() => {
                createServer({
                    scriptRootFolder: "my/script/root",
                    virtualRootFolder: "$root",
                    tryReadScriptAsString: () => {
                        throw Error("should not be called");
                    }
                });
            }, (ex: Error) => {
                return ex.message === "scriptRootFolder must start with /";
            });
        },

        "should throw on trailing slash in script root folder": () => {
            assert.throws(() => {
                createServer({
                    scriptRootFolder: "/my/script/root/",
                    virtualRootFolder: "$root",
                    tryReadScriptAsString: () => {
                        throw Error("should not be called");
                    }
                });
            }, (ex: Error) => {
                return ex.message === "scriptRootFolder must not end with /";
            });
        },

        "should throw on '.' in script root folder": () => {
            assert.throws(() => {
                createServer({
                    scriptRootFolder: "/my/./script/root",
                    virtualRootFolder: "$root",
                    tryReadScriptAsString: () => {
                        throw Error("should not be called");
                    }
                });
            }, (ex: Error) => {
                return ex.message === "scriptRootFolder must not contain .";
            });
        },

        "should throw on '..' in script root folder": () => {
            assert.throws(() => {
                createServer({
                    scriptRootFolder: "/my/../script/root",
                    virtualRootFolder: "$root",
                    tryReadScriptAsString: () => {
                        throw Error("should not be called");
                    }
                });
            }, (ex: Error) => {
                return ex.message === "scriptRootFolder must not contain ..";
            });
        },

        "should throw on '//' in script root folder": () => {
            assert.throws(() => {
                createServer({
                    scriptRootFolder: "/my//script/root",
                    virtualRootFolder: "$root",
                    tryReadScriptAsString: () => {
                        throw Error("should not be called");
                    }
                });
            }, (ex: Error) => {
                return ex.message === "scriptRootFolder must not contain //";
            });
        }
    }
};

export {
    serverTestGroup
};
