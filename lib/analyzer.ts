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

type TCodeAnalyzeReturn = TMaybeError<{ result: ICodeAnalyzeResult }>;

const defaultCodeAnalyzer = ({ code }: { code: string }): TCodeAnalyzeReturn => {
    try {
        const scriptAsAst = parseAst(code, {
            range: true
        });

        let imports: IImportStatement[] = [];

        // @ts-ignore
        estraverse.traverse(scriptAsAst, {
            enter: (node) => {
                if (node.type === "ImportDeclaration" && node.source.type === "Literal") {
                    imports = [
                        ...imports,
                        {
                            value: node.source.value as string,
                            range: {
                                from: node.source.range![0],
                                to: node.source.range![1]
                            }
                        }
                    ];
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
    TCodeAnalyzeReturn
};
