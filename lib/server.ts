import { defaultCodeAnalyzer } from "./analyzer.ts";
import { createLogger } from "./log.ts";
import pathe from "pathe";

import type { TMaybeError } from "./util.ts";
import type {
  TCodeAnalyzeReturn,
  TCodeAnalyzeFunc
} from "./analyzer.ts";
import type { TTryReadError, TTryReadErrorCode } from "./errors.ts";
import { createImportRewriter } from "./import-rewriter.ts";
import { createImportResolver } from "./import-resolver.ts";

type TTryReadResult = TMaybeError<{ content: string }, TTryReadError>;
type TTryReadFunc = (args: { filePath: string }) => globalThis.Promise<TTryReadResult>;

type THandleRequestResultType = "REDIRECT" | "FILE" | "ERROR";
type THandleRequestError = "SYNTAX_ERROR" | "MODULE_NOT_FOUND";

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

// eslint-disable-next-line complexity
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

const createEs6DebugServer = ({
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

  const loadLogger = createLogger({ name: "server.load" });
  const requestLogger = createLogger({ name: "server.request" });

  assertNiceAbsolutePath({ name: "scriptRootFolder", path: scriptRootFolder });

  const parts = scriptRootFolder.split("/");
  parts.forEach((part) => {
    if (part === "..") {
      throw Error("scriptRootFolder must not contain ..");
    }
  });

  const rootPrefix = `/${virtualRootFolder}/`;

  let requestCounter = 0;

  const importResolver = createImportResolver({
    resolveImportPath
  });

  const importRewriter = createImportRewriter({
    analyzeCode,
    importResolver
  });

  // eslint-disable-next-line max-statements
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
    // eslint-disable-next-line complexity
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

    const uriParts = uri.split("/");
    uriParts.forEach((part) => {
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

      // eslint-disable-next-line max-statements, complexity
      tryReadScriptAsString({ filePath }).then(async ({ error: readError, content }) => {

        if (canceled) {
          return;
        }

        if (readError !== undefined) {
          loadLogger(`failed to load script from "${filePath}"`, readError);
          requestLogger(`request for "${uri}" (req ${requestId}) failed as script could not be read`, readError);

          if (readError.readErrorCode === "FILE_NOT_FOUND") {
            handleFileNotFound();
            return;
          }

          handleInternalError({ error: Error(`failed to read file "${filePath}" resolved from "${uri}"`, { cause: readError }) });
          return;
        }

        loadLogger(`loaded script from "${filePath}", ${content.length} bytes`);

        const { error: rewriteError, rewrittenCode } = await importRewriter.rewrite({
          code: content,
          importer: filePath
        });

        if (rewriteError !== undefined) {

          const error = Error(`failed to rewrite imports in file "${filePath}" resolved from "${uri}"`, { cause: rewriteError });

          requestLogger(error.message, rewriteError);
          handleInternalError({ error });
          return;
        }

        requestLogger(`request for "${uri}" (req ${requestId}) successful, serving ${rewrittenCode.length} bytes of code`);
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
  createEs6DebugServer,
  defaultImportResolver,
};

export type {
  TResolveImportPathFunc,
  TResolveImportPathResult,
  TTryReadFunc,
  TTryReadError,
  TTryReadResult,
  TCodeAnalyzeReturn,
  TCodeAnalyzeFunc,
  THandleRequestError,
  THandleRequestResultType,
  TTryReadErrorCode
};
