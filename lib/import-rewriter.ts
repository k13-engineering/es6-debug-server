import pathe from "pathe";
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
        targetPath = pathe.relative(pathe.dirname(importer), absoluteOrRelativePath);

        if (!targetPath.startsWith("./") && !targetPath.startsWith("../")) {
          targetPath = `./${targetPath}`;
        }
      }

      return {
        replacement: `"${targetPath}"`,
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
