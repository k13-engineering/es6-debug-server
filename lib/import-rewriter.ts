import { posix } from "node:path";
import { createCodeReplacer } from "./code-replacer.ts";
import type { TCodeAnalyzeFunc } from "./analyzer.ts";
import type { TImportResolver } from "./import-resolver.ts";

type TRewriteResult = {
  error: Error;
  rewrittenCode: undefined;
  importedFilePaths?: undefined;
} | {
  error: undefined;
  rewrittenCode: string;
  // the file paths of the imports that were resolved, where a browser will request them
  importedFilePaths: string[];
};

// an import specifier is a url, so a file name with e.g. "#", "?" or "%" in it has to be percent-encoded
const encodeUriPath = ({ path }: { path: string }) => {
  return encodeURI(path).replace(/[?#]/gu, (character) => {
    return encodeURIComponent(character);
  });
};

// the path of an import relative to the importer, as a url
const targetPathOf = ({ importer, absoluteOrRelativePath }: { importer: string, absoluteOrRelativePath: string }) => {
  if (!absoluteOrRelativePath.startsWith("/")) {
    return absoluteOrRelativePath;
  }

  // posix, not pathe: a file name may contain a \, which pathe takes for a separator
  const relativePath = posix.relative(posix.dirname(importer), absoluteOrRelativePath);

  if (relativePath.startsWith("./") || relativePath.startsWith("../")) {
    return encodeUriPath({ path: relativePath });
  }

  return encodeUriPath({ path: `./${relativePath}` });
};

// the file path of an import, a result of the resolver that is neither a file path nor relative, e.g. a
// url, is not on this server
const importedFilePathOf = ({ importer, absoluteOrRelativePath }: { importer: string, absoluteOrRelativePath: string }) => {
  if (absoluteOrRelativePath.startsWith("/")) {
    return posix.normalize(absoluteOrRelativePath);
  }

  if (absoluteOrRelativePath.startsWith("./") || absoluteOrRelativePath.startsWith("../")) {
    return posix.join(posix.dirname(importer), absoluteOrRelativePath);
  }

  return undefined;
};

const createImportRewriter = ({
  analyzeCode,
  importResolver,
}: {
  analyzeCode: TCodeAnalyzeFunc,
  importResolver: TImportResolver
}) => {

  const codeReplacer = createCodeReplacer();

  const rewrite = async ({ code, importer }: { code: string, importer: string }): Promise<TRewriteResult> => {
    const analyzeResult = analyzeCode({ code });

    if (analyzeResult.error !== undefined) {

      return {
        error: Error("code analysis failed", { cause: analyzeResult.error }),
        rewrittenCode: undefined
      };
    }

    const importsToRewrite = analyzeResult.result.imports;

    const staticImports = importsToRewrite.filter((imp) => {
      return imp.dynamic !== true;
    });

    const dynamicImports = importsToRewrite.filter((imp) => {
      return imp.dynamic === true;
    });

    const { error: resolveError, resolved } = await importResolver.resolveAllImports({
      importer,
      specifiers: staticImports.map((imp) => {
        return imp.value;
      }),
    });

    if (resolveError !== undefined) {
      return {
        error: Error("import path resolution failed", { cause: resolveError }),
        rewrittenCode: undefined
      };
    }

    // a dynamic import may be of a module that is missing on purpose, e.g. inside a try block, so one that
    // can not be resolved is left as it is, to fail where the script runs instead of failing the whole script
    const resolvedDynamic = await Promise.all(dynamicImports.map(async (imp) => {
      const result = await importResolver.resolveAllImports({ importer, specifiers: [imp.value] });
      return result.error === undefined ? result.resolved[0] : undefined;
    }));

    const resolvedImports = [
      ...staticImports.map((imported, index) => {
        return { imported, absoluteOrRelativePath: resolved[index] };
      }),
      ...dynamicImports.flatMap((imported, index) => {
        const absoluteOrRelativePath = resolvedDynamic[index];
        return absoluteOrRelativePath === undefined ? [] : [{ imported, absoluteOrRelativePath }];
      })
    ];

    const replacements = resolvedImports.map(({ imported, absoluteOrRelativePath }) => {
      return {
        // a string literal, whatever quotes or line breaks the path contains
        replacement: JSON.stringify(targetPathOf({ importer, absoluteOrRelativePath })),
        range: imported.range
      };
    });

    const rewrittenCode = codeReplacer.replaceCode({
      code,
      replacements
    });

    const importedFilePaths = resolvedImports.flatMap(({ absoluteOrRelativePath }) => {
      const importedFilePath = importedFilePathOf({ importer, absoluteOrRelativePath });
      return importedFilePath === undefined ? [] : [importedFilePath];
    });

    return {
      error: undefined,
      rewrittenCode,
      importedFilePaths
    };
  };

  return {
    rewrite
  };
};

export {
  createImportRewriter
};
