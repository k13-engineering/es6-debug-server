import assert from "node:assert/strict";
import { parse, simpleTraverse } from "@typescript-eslint/typescript-estree";
import { createReadError } from "../lib/index.ts";
import type { createEs6DebugServer, TTryReadFunc } from "../lib/index.ts";

type TServer = ReturnType<typeof createEs6DebugServer>;

type TOutcome = {
  kind: "content",
  contentType: string,
  content: string
} | {
  kind: "redirect",
  uri: string,
  relativeUri: string
} | {
  kind: "file-not-found"
} | {
  kind: "internal-error",
  error: Error
} | {
  // handleRequest itself threw
  kind: "rejected",
  error: unknown
} | {
  // an exception escaped the server, in production this crashes the process
  kind: "unhandled-rejection",
  error: unknown
} | {
  kind: "no-answer"
};

const answerTimeoutMs = 500;

// a file system in memory that, like a plain readFile, reads whatever path it is asked for,
// it records every path the server asks for
const createFakeFileSystem = ({ files }: { files: { [filePath: string]: string } }) => {
  let readPaths: string[] = [];

  const tryReadScriptAsString: TTryReadFunc = async ({ filePath }) => {
    readPaths = [...readPaths, filePath];

    if (!Object.hasOwn(files, filePath)) {
      return {
        error: createReadError({ code: "FILE_NOT_FOUND", message: `no such file "${filePath}"` })
      };
    }

    return {
      error: undefined,
      content: files[filePath]
    };
  };

  return {
    tryReadScriptAsString,
    readPaths: () => {
      return readPaths;
    }
  };
};

const describeOutcome = ({ outcome }: { outcome: TOutcome }) => {
  if (outcome.kind === "content") {
    return `content ${JSON.stringify(outcome.content)}`;
  }

  if (outcome.kind === "redirect") {
    return `redirect to "${outcome.uri}"`;
  }

  if ("error" in outcome) {
    return `${outcome.kind} (${String(outcome.error)})`;
  }

  return outcome.kind;
};

const assertOutcomeKind = ({ outcome, kind }: { outcome: TOutcome, kind: TOutcome["kind"] }) => {
  assert.strictEqual(outcome.kind, kind, `expected ${kind}, got ${describeOutcome({ outcome })}`);
};

// performs a request and reports how the server answered it, a request that is never answered, e.g.
// because an exception escaped as an unhandled rejection, is reported as such instead of timing out
const requestOutcome = ({ server, uri }: { server: TServer, uri: string }) => {
  return new Promise<TOutcome>((resolve) => {
    let answered = false;
    let timeout: NodeJS.Timeout | undefined = undefined;

    const onUnhandledRejection = (error: unknown) => {
      // eslint-disable-next-line no-use-before-define
      answer({ outcome: { kind: "unhandled-rejection", error } });
    };

    const answer = ({ outcome }: { outcome: TOutcome }) => {
      if (answered) {
        return;
      }

      answered = true;
      clearTimeout(timeout);
      process.off("unhandledRejection", onUnhandledRejection);
      resolve(outcome);
    };

    process.on("unhandledRejection", onUnhandledRejection);

    timeout = setTimeout(() => {
      answer({ outcome: { kind: "no-answer" } });
    }, answerTimeoutMs);

    server.handleRequest({
      uri,
      handleContent: ({ contentType, content }) => {
        answer({ outcome: { kind: "content", contentType, content } });
      },
      handleRedirect: ({ uri: redirectUri, relativeUri }) => {
        answer({ outcome: { kind: "redirect", uri: redirectUri, relativeUri } });
      },
      handleFileNotFound: () => {
        answer({ outcome: { kind: "file-not-found" } });
      },
      handleInternalError: ({ error }) => {
        answer({ outcome: { kind: "internal-error", error } });
      }
    }).catch((error: unknown) => {
      answer({ outcome: { kind: "rejected", error } });
    });
  });
};

const origin = "http://localhost:8080";

const isPercentEncoded = ({ path }: { path: string }) => {
  try {
    decodeURIComponent(path);
    return true;
  } catch {
    return false;
  }
};

const encodePath = ({ path }: { path: string }) => {
  return path.split("/").map((segment) => {
    return encodeURIComponent(segment);
  }).join("/");
};

// what a consumer like an express router hands to the server: the decoded path of the requested url,
// without the path prefix of a reverse proxy in front of it
const uriOfUrl = ({ url, prefix }: { url: URL, prefix: string }) => {
  if (!isPercentEncoded({ path: url.pathname })) {
    assert.fail(`the browser requested "${url.pathname}", which is not a valid percent-encoded path`);
  }

  const path = decodeURIComponent(url.pathname);
  assert.ok(path.startsWith(`${prefix}/`), `"${url.href}" is not below the prefix "${prefix}"`);
  return path.substring(prefix.length);
};

type TFetchResult = { url: URL, outcome: TOutcome };

// what a browser does: request a url and follow redirects, resolving a relative location against the
// url it requested
const browserFetch = ({ server, url, prefix }: { server: TServer, url: URL, prefix: string }) => {
  const follow = async ({ current, redirectsLeft }: { current: URL, redirectsLeft: number }): Promise<TFetchResult> => {
    const outcome = await requestOutcome({ server, uri: uriOfUrl({ url: current, prefix }) });

    if (outcome.kind !== "redirect") {
      return { url: current, outcome };
    }

    assert.ok(redirectsLeft > 0, `too many redirects, the last one to "${outcome.uri}"`);

    return follow({
      current: new URL(encodePath({ path: outcome.relativeUri }), current),
      redirectsLeft: redirectsLeft - 1
    });
  };

  return follow({ current: url, redirectsLeft: 3 });
};

const urlOf = ({ path, prefix = "" }: { path: string, prefix?: string }) => {
  return new URL(`${origin}${prefix}${encodePath({ path })}`);
};

type TSourceLike = { type: string, value?: unknown } | null | undefined;

const stringSourceOf = ({ node }: { node: { source?: unknown } }) => {
  const source = node.source as TSourceLike;

  if (source?.type !== "Literal" || typeof source.value !== "string") {
    return undefined;
  }

  return source.value;
};

// the specifiers of all static and dynamic imports as a browser sees them, it is deliberately independent
// of the analyzer of the server
const importSpecifiersOf = ({ code }: { code: string }) => {
  let specifiers: string[] = [];

  let ast: ReturnType<typeof parse> | undefined = undefined;

  try {
    ast = parse(code);
  } catch (ex) {
    assert.fail(`the served code does not parse (${(ex as Error).message}): ${JSON.stringify(code)}`);
  }

  simpleTraverse(ast, {
    enter: (node) => {
      const specifier = stringSourceOf({ node: node as { source?: unknown } });

      if (specifier !== undefined) {
        specifiers = [...specifiers, specifier];
      }
    }
  });

  return specifiers;
};

// resolves an import specifier the way a browser does, bare specifiers can not be resolved
const resolveAsBrowser = ({ specifier, scriptUrl }: { specifier: string, scriptUrl: URL }) => {
  const isRelative = ["/", "./", "../"].some((start) => {
    return specifier.startsWith(start);
  });

  if (!isRelative && !URL.canParse(specifier)) {
    assert.fail(`a browser can not resolve the bare specifier "${specifier}"`);
  }

  return new URL(specifier, scriptUrl);
};

// what a browser does with a served module: fetch every module it imports
const fetchImportsOf = async ({
  server,
  fetched,
  prefix
}: {
  server: TServer,
  fetched: TFetchResult,
  prefix: string
}) => {
  assertOutcomeKind({ outcome: fetched.outcome, kind: "content" });

  const { content } = fetched.outcome as { content: string };

  const specifiers = importSpecifiersOf({ code: content });

  let results: TFetchResult[] = [];

  // one after the other, so the reads of the file system are in order
  for (const specifier of specifiers) {
    const url = resolveAsBrowser({ specifier, scriptUrl: fetched.url });
    results = [...results, await browserFetch({ server, url, prefix })];
  }

  return results;
};

const allCausesOf = ({ error }: { error: unknown }): unknown[] => {
  if (!(error instanceof Error) || error.cause === undefined) {
    return [];
  }

  return [error.cause, ...allCausesOf({ error: error.cause })];
};

const createGate = () => {
  let open = () => { };

  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });

  return {
    opened,
    open: () => {
      open();
    }
  };
};

const settle = () => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 50);
  });
};

export {
  createFakeFileSystem,
  requestOutcome,
  assertOutcomeKind,
  describeOutcome,
  browserFetch,
  fetchImportsOf,
  importSpecifiersOf,
  urlOf,
  allCausesOf,
  createGate,
  settle,
};

export type {
  TServer,
  TOutcome,
  TFetchResult,
};
