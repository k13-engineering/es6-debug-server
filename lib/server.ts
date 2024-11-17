import { defaultCodeAnalyzer } from "./analyzer.ts";
import { dedupeStringArray } from "./util.ts";
import { createLogger } from "./log.ts";
import pathe from "pathe";

import type { TMaybeError } from "./util.ts";
import type {
    TCodeAnalyzeReturn,
    TCodeAnalyzeFunc
} from "./analyzer.ts";

enum ETryReadErrorCode {
    FILE_NOT_FOUND = "FILE_NOT_FOUND",
    IO_ERROR = "IO_ERROR"
};

type TTryReadError = Error & {
    readErrorCode?: ETryReadErrorCode;
};

type TTryReadResult = TMaybeError<{ content: string }, TTryReadError>;
type TTryReadFunc = (args: { filePath: string }) => globalThis.Promise<TTryReadResult>;

enum EHandleRequestResultType {
    REDIRECT = "REDIRECT",
    FILE = "FILE",
    ERROR = "ERROR"
};

enum EHandleRequestError {
    SYNTAX_ERROR = "SYNTAX_ERROR",
    MODULE_NOT_FOUND = "MODULE_NOT_FOUND",
};

type TResolveImportPathResult = TMaybeError<{ filePath: string }>;
type TResolveImportPathFunc = (args: { importer: string, specifier: string }) => globalThis.Promise<TResolveImportPathResult>;

const defaultImportResolver: TResolveImportPathFunc = ({ importer, specifier }) => {
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
        return Promise.resolve({
            error: undefined,
            filePath: pathe.join(pathe.dirname(importer), specifier)
        });
    }

    throw Error(`only relative imports are supported, provide a custom resolveImportPath function to handle non-relative imports`);
};

const assertNiceAbsolutePath = ({ name, path }: { name: string, path: string }) => {
    const parts = path.split("/");

    if (!path.startsWith("/")) {
        throw Error(`${name} must start with /`);
    }

    if (path.includes("//")) {
        throw Error(`${name} must not contain //`);
    }

    if (parts.includes(".")) {
        throw Error(`${name} must not contain .`);
    }

    if (parts.includes("..")) {
        throw Error(`${name} must not contain ..`);
    }

    if (path.endsWith("/")) {
        throw Error(`${name} must not end with /`);
    }
};

const createReadError = ({ code, message, cause }: { code: ETryReadErrorCode, message: string, cause?: Error }): TTryReadError => {
    const error: TTryReadError = Error(message, { cause });
    error.readErrorCode = code;
    return error;
};

const create = ({
    virtualRootFolder = "$root",
    scriptRootFolder,
    tryReadScriptAsString,
    analyzeCode = defaultCodeAnalyzer,
    resolveImportPath = defaultImportResolver,
}: {
    virtualRootFolder?: string,
    scriptRootFolder: string,
    tryReadScriptAsString: TTryReadFunc,
    analyzeCode?: TCodeAnalyzeFunc,
    resolveImportPath?: TResolveImportPathFunc
}) => {

    const importResolveLogger = createLogger({ name: "server.resolve" });
    const loadLogger = createLogger({ name: "server.load" });
    const requestLogger = createLogger({ name: "server.request" });

    assertNiceAbsolutePath({ name: "scriptRootFolder", path: scriptRootFolder });

    const parts = scriptRootFolder.split("/");
    parts.forEach((part) => {
        if (part === "..") {
            throw Error("scriptRootFolder must not contain ..");
        }
    });

    interface IResolveAllImportsSuccessResult {
        resolved: string[];
    };

    const resolveAllImports = async ({ importer, specifiers }: { importer: string, specifiers: string[] }): Promise<TMaybeError<IResolveAllImportsSuccessResult>> => {
        const uniqueSpecifiers = dedupeStringArray({ array: specifiers });

        const results = await Promise.all(uniqueSpecifiers.map(async (specifier) => {

            const result = await resolveImportPath({ importer, specifier });

            if (result.error !== undefined) {
                importResolveLogger(`failed to resolve import "${specifier}" from "${importer}"`, result.error);
            } else {
                importResolveLogger(`resolved import "${specifier}" from "${importer}" to "${result.filePath}"`);
            }

            return result;
        }));

        const anyErrorResult = results.find((result) => {
            return result.error !== undefined;
        });

        if (anyErrorResult !== undefined) {
            return {
                error: anyErrorResult.error!
            };
        }

        let resultsByKey: { [key: string]: string } = {};
        results.forEach((result, index) => {
            const specifier = uniqueSpecifiers[index];

            resultsByKey = {
                ...resultsByKey,
                [specifier]: result.filePath!
            };
        });

        const resolved = specifiers.map((specifier) => {
            return resultsByKey[specifier];
        });

        return {
            error: undefined,
            resolved
        };
    };

    interface ICodeReplacement {
        replacement: string;
        range: {
            from: number;
            to: number;
        };
    };

    const rewriteCode = ({ code, replacements }: { code: string, replacements: ICodeReplacement[] }) => {

        const replacementsLastToFirst = replacements.slice().sort((a, b) => {
            return b.range.from - a.range.from;
        });

        let result = code;

        replacementsLastToFirst.forEach((replacement) => {
            const { from, to } = replacement.range;
            const before = result.substring(0, from);
            const after = result.substring(to);
            result = `${before}${replacement.replacement}${after}`;
        });

        return result;
    };

    const rootPrefix = `/${virtualRootFolder}/`;

    let requestCounter = 0;

    const handleRequest = async ({
        uri,

        handleContent,
        handleRedirect,
        handleFileNotFound,
        handleInternalError,
    }: {
        uri: string,

        handleContent: (args: { contentType: string, content: string }) => void;
        handleRedirect: (args: { uri: string }) => void;
        handleFileNotFound: () => void;
        handleInternalError: (args: { error: Error }) => void;
    }) => {

        const requestId = requestCounter;
        requestCounter += 1;

        requestLogger(`incoming request for "${uri}" (req ${requestId})`);

        let canceled = false;

        if (uri.includes("//")) {
            throw Error("uri must not contain //");
        }

        if (!uri.startsWith("/")) {
            throw Error("uri must start with /");
        }

        const parts = uri.split("/");
        parts.forEach((part) => {
            if (part === "..") {
                throw Error("uri must not contain ..");
            }
        });

        if (uri.startsWith(rootPrefix)) {

            const relativePathInRoot = uri.substring(rootPrefix.length);

            // relativePath does not have a leading slash
            // relativePath does not have double slashes
            // relativePath does not have .. in it
            const filePath = `/${relativePathInRoot}`;

            loadLogger(`trying to load script from "${filePath}"`);

            tryReadScriptAsString({ filePath }).then(async ({ error: readError, content }) => {

                if (canceled) {
                    return;
                }

                if (readError !== undefined) {
                    loadLogger(`failed to load script from "${filePath}"`, readError);
                    requestLogger(`request for "${uri}" (req ${requestId}) failed as script could not be read`, readError);

                    if (readError.readErrorCode === ETryReadErrorCode.FILE_NOT_FOUND) {
                        handleFileNotFound();
                        return;
                    }

                    handleInternalError({ error: Error(`failed to read file "${filePath}" resolved from "${uri}"`, { cause: readError }) });
                    return;
                }

                loadLogger(`loaded script from "${filePath}", ${content.length} bytes`);

                const analyzeResult = analyzeCode({ code: content });

                if (analyzeResult.error !== undefined) {
                    requestLogger(`request for "${uri}" (req ${requestId}) failed as script could not be analyzed`, analyzeResult.error);
                    handleInternalError({ error: analyzeResult.error });
                    return;
                }

                const imports = analyzeResult.result.imports;

                const importsToRewrite = imports.filter((imp) => {
                    return !imp.value.startsWith("./") && !imp.value.startsWith("../");
                });

                const importer = filePath;

                const { error: resolveError, resolved } = await resolveAllImports({
                    importer,
                    specifiers: importsToRewrite.map((imp) => {
                        return imp.value;
                    }),
                });

                if (canceled) {
                    return;
                }

                if (resolveError !== undefined) {
                    requestLogger(`request for "${uri}" (req ${requestId}) failed as imports could not be resolved`, resolveError);
                    handleInternalError({ error: resolveError });
                    return;
                }

                const replacements = importsToRewrite.map((imported, index) => {

                    const absoluteOrRelativePath = resolved[index];

                    let targetPath = absoluteOrRelativePath;

                    if (absoluteOrRelativePath.startsWith("/")) {
                        targetPath = pathe.relative(pathe.dirname(importer), absoluteOrRelativePath);
                    }

                    return {
                        replacement: `"${targetPath}"`,
                        range: imported.range
                    };
                });

                const rewrittenCode = rewriteCode({
                    code: content,
                    replacements
                });

                requestLogger(`request for "${uri}" (req ${requestId}) successful, serving ${rewriteCode.length} bytes of code`);
                handleContent({
                    contentType: "text/javascript",
                    content: rewrittenCode
                });
            });

            const cancel = () => {
                canceled = true;
            };

            return {
                cancel
            };
        }

        const relativePath = uri.substring(1);
        if (relativePath.startsWith("/")) {
            throw Error("uri must not start with //");
        }


        const redirectUri = `/${virtualRootFolder}${scriptRootFolder}/${relativePath}`;
        requestLogger(`request for "${uri}" (req ${requestId}) will be redirected to "${redirectUri}"`);
        handleRedirect({ uri: redirectUri });

        return {
            cancel: () => { }
        };
    };

    return {
        handleRequest
    };
};

export {
    createReadError,
    create,
    defaultImportResolver,

    EHandleRequestError,
    EHandleRequestResultType,
    ETryReadErrorCode
};

export type {
    TResolveImportPathFunc,
    TResolveImportPathResult,
    TTryReadFunc,
    TTryReadError,
    TTryReadResult,
    TCodeAnalyzeReturn,
    TCodeAnalyzeFunc,
};
