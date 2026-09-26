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

type TLoadScriptResult = {
  kind: "content",
  content: string
} | {
  kind: "file-not-found"
} | {
  kind: "internal-error",
  error: Error
} | {
  kind: "canceled"
};

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

  return Promise.resolve({
    error: Error(`only relative imports are supported, provide a custom resolveImportPath function to handle "${specifier}"`)
  });
};

// Expresses the absolute uri `to` relative to the requested uri `from`, e.g. from "/ui/index.js" to
// "/$root/my/script/root/ui/index.js" gives "../$root/my/script/root/ui/index.js". A client resolves
// such a relative redirect against the URL it actually requested, so the redirect stays below any
// path prefix the server itself cannot see, like a reverse proxy serving it under "/production/".
const relativeUriOf = ({ from, to }: { from: string, to: string }) => {
  // only the path counts, a query or fragment may contain slashes of its own
  const [pathOfFrom] = from.split(/[?#]/u);
  const depth = pathOfFrom.split("/").length - 2;
  const up = depth === 0 ? "./" : "../".repeat(depth);
  return `${up}${to.substring(1)}`;
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

  const rootPrefix = `/${virtualRootFolder}/`;

  let requestCounter = 0;

  const importResolver = createImportResolver({
    resolveImportPath
  });

  const importRewriter = createImportRewriter({
    analyzeCode,
    importResolver
  });

  const loadScript = async ({
    filePath,
    uri,
    requestId,
    isCanceled
  }: {
    filePath: string,
    uri: string,
    requestId: number,
    isCanceled: () => boolean
    // eslint-disable-next-line max-statements, complexity
  }): Promise<TLoadScriptResult> => {

    loadLogger(`trying to load script from "${filePath}"`);

    const { error: readError, content } = await tryReadScriptAsString({ filePath });

    if (isCanceled()) {
      return { kind: "canceled" };
    }

    if (readError !== undefined) {
      loadLogger(`failed to load script from "${filePath}"`, readError);
      requestLogger(`request for "${uri}" (req ${requestId}) failed as script could not be read`, readError);

      if (readError.readErrorCode === "FILE_NOT_FOUND") {
        return { kind: "file-not-found" };
      }

      return {
        kind: "internal-error",
        error: Error(`failed to read file "${filePath}" resolved from "${uri}"`, { cause: readError })
      };
    }

    loadLogger(`loaded script from "${filePath}", ${content.length} bytes`);

    const { error: rewriteError, rewrittenCode } = await importRewriter.rewrite({
      code: content,
      importer: filePath
    });

    if (rewriteError !== undefined) {

      const error = Error(`failed to rewrite imports in file "${filePath}" resolved from "${uri}"`, { cause: rewriteError });

      requestLogger(error.message, rewriteError);
      return { kind: "internal-error", error };
    }

    requestLogger(`request for "${uri}" (req ${requestId}) successful, serving ${rewrittenCode.length} bytes of code`);
    return { kind: "content", content: rewrittenCode };
  };

  // an exception thrown by a provided function, e.g. tryReadScriptAsString or resolveImportPath, must not
  // escape as an unhandled rejection, that would take down the whole process
  const loadScriptSafely = async (args: Parameters<typeof loadScript>[0]): Promise<TLoadScriptResult> => {
    try {
      return await loadScript(args);
    } catch (ex) {
      const error = Error(`failed to load script "${args.filePath}" resolved from "${args.uri}"`, { cause: ex });
      requestLogger(error.message, ex);
      return { kind: "internal-error", error };
    }
  };

  const handleRequest = async ({
    uri,

    handleContent,
    handleRedirect,
    handleFileNotFound,
    handleInternalError,
  }: {
    uri: string,

    handleContent: (args: { contentType: string, content: string }) => void;
    // `uri` is the redirect target as an absolute path below the server root, `relativeUri` is the
    // same target relative to the requested uri. Prefer `relativeUri` as the Location of a redirect:
    // it keeps working when the server is reached below a path prefix it does not know about.
    handleRedirect: (args: { uri: string, relativeUri: string }) => void;
    handleFileNotFound: () => void;
    handleInternalError: (args: { error: Error }) => void;
    // eslint-disable-next-line max-statements, complexity
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

    // a file path ends at a null byte for some file systems, which cuts off e.g. the extension of a path
    if (uri.includes("\0")) {
      throw Error("uri must not contain null bytes");
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

      const isCanceled = () => {
        return canceled;
      };

      // the handlers are called outside of loadScriptSafely, so an exception thrown by one of them is
      // not answered a second time as an internal error
      // eslint-disable-next-line complexity
      void loadScriptSafely({ filePath, uri, requestId, isCanceled }).then((result) => {

        // the request may have been canceled while the script was loaded
        if (canceled || result.kind === "canceled") {
          return;
        }

        if (result.kind === "file-not-found") {
          handleFileNotFound();
          return;
        }

        if (result.kind === "internal-error") {
          handleInternalError({ error: result.error });
          return;
        }

        handleContent({
          contentType: "text/javascript",
          content: result.content
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

    const redirectUri = `/${virtualRootFolder}${scriptRootFolder}/${relativePath}`;
    requestLogger(`request for "${uri}" (req ${requestId}) will be redirected to "${redirectUri}"`);
    handleRedirect({ uri: redirectUri, relativeUri: relativeUriOf({ from: uri, to: redirectUri }) });

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
