import estraverse from "estraverse";
import { parse as parseAst } from "@typescript-eslint/typescript-estree";

import type { TMaybeError } from "./util.ts";

interface IImportStatement {
    value: string;
    range: {
        from: number;
        to: number;
    };
};

interface ICodeAnalyzeResult {
    imports: IImportStatement[];
};

type TImportLikeSource = {
    type: string;
    value?: unknown;
    range?: [number, number] | null;
} | null | undefined;

type TCodeAnalyzeReturn = TMaybeError<{ result: ICodeAnalyzeResult }>;
type TCodeAnalyzeFunc = (args: { code: string }) => TCodeAnalyzeReturn;

const defaultCodeAnalyzer: TCodeAnalyzeFunc = ({ code }) => {
    try {
        const scriptAsAst = parseAst(code, {
            range: true
        });

        let imports: IImportStatement[] = [];

        const appendSourceAsImport = (source: TImportLikeSource) => {
            if (source?.type !== "Literal" || typeof source.value !== "string" || source.range === undefined || source.range === null) {
                return;
            }

            imports = [
                ...imports,
                {
                    value: source.value,
                    range: {
                        from: source.range[0],
                        to: source.range[1]
                    }
                }
            ];
        };

        // @ts-ignore
        estraverse.traverse(scriptAsAst, {
            enter: (node) => {
                if (
                    node.type === "ImportDeclaration"
                    || node.type === "ExportAllDeclaration"
                    || node.type === "ExportNamedDeclaration"
                ) {
                    appendSourceAsImport(node.source as TImportLikeSource);
                }
            }
        });

        return {
            error: undefined,
            result: {
                imports
            }
        };
    } catch (ex) {
        return {
            error: ex as Error
        };
    }
};

export {
    defaultCodeAnalyzer
};

export type {
    IImportStatement,
    ICodeAnalyzeResult,
    TCodeAnalyzeReturn,
    TCodeAnalyzeFunc,
};
