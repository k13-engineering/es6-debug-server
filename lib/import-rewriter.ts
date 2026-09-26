import { posix } from "node:path";
import { createCodeReplacer } from "./code-replacer.ts";
import type { TCodeAnalyzeFunc } from "./analyzer.ts";
import type { TImportResolver } from "./import-resolver.ts";

type TRewriteResult = {
  error: Error;
  rewrittenCode: undefined;
} | {
  error: undefined;
  rewrittenCode: string;
};

// an import specifier is a url, so a file name with e.g. "#", "?" or "%" in it has to be percent-encoded
const encodeUriPath = ({ path }: { path: string }) => {
  return encodeURI(path).replace(/[?#]/gu, (character) => {
    return encodeURIComponent(character);
  });
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

    const { error: resolveError, resolved } = await importResolver.resolveAllImports({
      importer,
      specifiers: importsToRewrite.map((imp) => {
        return imp.value;
      }),
    });

    if (resolveError !== undefined) {
      return {
        error: Error("import path resolution failed", { cause: resolveError }),
        rewrittenCode: undefined
      };
    }

    const replacements = importsToRewrite.map((imported, index) => {

      const absoluteOrRelativePath = resolved[index];

      let targetPath = absoluteOrRelativePath;

      if (absoluteOrRelativePath.startsWith("/")) {
        // posix, not pathe: a file name may contain a \, which pathe takes for a separator
        targetPath = posix.relative(posix.dirname(importer), absoluteOrRelativePath);

        if (!targetPath.startsWith("./") && !targetPath.startsWith("../")) {
          targetPath = `./${targetPath}`;
        }

        targetPath = encodeUriPath({ path: targetPath });
      }

      return {
        // a string literal, whatever quotes or line breaks the path contains
        replacement: JSON.stringify(targetPath),
        range: imported.range
      };
    });

    const rewrittenCode = codeReplacer.replaceCode({
      code,
      replacements
    });

    return {
      error: undefined,
      rewrittenCode
    };
  };

  return {
    rewrite
  };
};

export {
  createImportRewriter
};
