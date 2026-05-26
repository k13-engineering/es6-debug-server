import { createLogger } from "./log.ts";
import { dedupeStringArray, type TMaybeError } from "./util.ts";

type TResolveAllImportsSuccessResult = {
  resolved: string[];
};

type TResolveImportPathResult = TMaybeError<{ filePath: string }>;
type TResolveImportPathFunc = (args: { importer: string, specifier: string }) => globalThis.Promise<TResolveImportPathResult>;

const importResolveLogger = createLogger({ name: "server.resolve" });

const createImportResolver = ({
  resolveImportPath
}: {
  resolveImportPath: TResolveImportPathFunc
}) => {

  const resolveAllImports = async ({
    importer,
    specifiers
  }: {
    importer: string,
    specifiers: string[]
  }): Promise<TMaybeError<TResolveAllImportsSuccessResult>> => {
    const uniqueSpecifiers = dedupeStringArray({ array: specifiers });

    const results = await Promise.all(uniqueSpecifiers.map(async (specifier) => {

      const { error: resolveError, filePath } = await resolveImportPath({ importer, specifier });

      // eslint-disable-next-line no-negated-condition
      if (resolveError !== undefined) {
        importResolveLogger(`failed to resolve import "${specifier}" from "${importer}"`, resolveError);

        return {
          error: Error(`failed to resolve import "${specifier}" from "${importer}"`, { cause: resolveError })
        };
      } else {
        importResolveLogger(`resolved import "${specifier}" from "${importer}" to "${filePath}"`);
      }

      return {
        error: undefined,
        filePath
      };
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

  return {
    resolveAllImports
  };
};

type TImportResolver = ReturnType<typeof createImportResolver>;

export {
  createImportResolver
};

export type {
  TImportResolver,
  TResolveImportPathFunc
};
