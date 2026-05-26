import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { createImportRewriter } from "./import-rewriter.ts";
import type { TCodeAnalyzeFunc } from "./analyzer.ts";
import type { TImportResolver } from "./import-resolver.ts";

describe("createImportRewriter", () => {
  describe("rewrite", () => {
    it("returns an error when code analysis fails", async () => {
      const analyzeCode: TCodeAnalyzeFunc = () => {
        return { error: Error("parse error") };
      };
      const importResolver: TImportResolver = {
        resolveAllImports: async () => {
          return { error: undefined, resolved: [] };
        }
      };

      const { rewrite } = createImportRewriter({ analyzeCode, importResolver });
      const result = await rewrite({ code: "bad code @@!", importer: "/project/src/main.ts" });

      assert.ok(result.error instanceof Error);
      assert.strictEqual(result.error.message, "code analysis failed");
      assert.strictEqual(result.rewrittenCode, undefined);
    });

    it("returns an error when import resolution fails", async () => {
      const analyzeCode: TCodeAnalyzeFunc = () => {
        return {
          error: undefined,
          result: {
            imports: [{ value: "./foo.ts", range: { from: 16, to: 26 } }]
          }
        };
      };
      const importResolver: TImportResolver = {
        resolveAllImports: async () => {
          return { error: Error("resolution error") };
        }
      };

      const { rewrite } = createImportRewriter({ analyzeCode, importResolver });
      const result = await rewrite({
        code: `import foo from "./foo.ts";`,
        importer: "/project/src/main.ts"
      });

      assert.ok(result.error instanceof Error);
      assert.strictEqual(result.error.message, "import path resolution failed");
      assert.strictEqual(result.rewrittenCode, undefined);
    });

    it("returns the original code unchanged when there are no imports", async () => {
      const code = "const x = 1;";
      const analyzeCode: TCodeAnalyzeFunc = () => {
        return { error: undefined, result: { imports: [] } };
      };
      const importResolver: TImportResolver = {
        resolveAllImports: async () => {
          return { error: undefined, resolved: [] };
        }
      };

      const { rewrite } = createImportRewriter({ analyzeCode, importResolver });
      const result = await rewrite({ code, importer: "/project/src/main.ts" });

      assert.strictEqual(result.error, undefined);
      assert.strictEqual(result.rewrittenCode, code);
    });

    it("keeps a relative import path unchanged", async () => {
      const code = `import foo from "./foo.ts";`;
      const analyzeCode: TCodeAnalyzeFunc = () => {
        return {
          error: undefined,
          result: {
            imports: [{ value: "./foo.ts", range: { from: 16, to: 26 } }]
          }
        };
      };
      const importResolver: TImportResolver = {
        resolveAllImports: async () => {
          return { error: undefined, resolved: ["./foo.ts"] };
        }
      };

      const { rewrite } = createImportRewriter({ analyzeCode, importResolver });
      const result = await rewrite({ code, importer: "/project/src/main.ts" });

      assert.strictEqual(result.error, undefined);
      assert.strictEqual(result.rewrittenCode, `import foo from "./foo.ts";`);
    });

    it("converts an absolute path in the same directory to a ./-prefixed relative path", async () => {
      const code = `import foo from "./foo.ts";`;
      const analyzeCode: TCodeAnalyzeFunc = () => {
        return {
          error: undefined,
          result: {
            imports: [{ value: "./foo.ts", range: { from: 16, to: 26 } }]
          }
        };
      };
      const importResolver: TImportResolver = {
        resolveAllImports: async () => {
          return { error: undefined, resolved: ["/project/src/bar.ts"] };
        }
      };

      const { rewrite } = createImportRewriter({ analyzeCode, importResolver });
      const result = await rewrite({ code, importer: "/project/src/main.ts" });

      assert.strictEqual(result.error, undefined);
      assert.strictEqual(result.rewrittenCode, `import foo from "./bar.ts";`);
    });

    it("converts an absolute path in a sibling directory to a ../-prefixed relative path", async () => {
      const code = `import foo from "./foo.ts";`;
      const analyzeCode: TCodeAnalyzeFunc = () => {
        return {
          error: undefined,
          result: {
            imports: [{ value: "./foo.ts", range: { from: 16, to: 26 } }]
          }
        };
      };
      const importResolver: TImportResolver = {
        resolveAllImports: async () => {
          return { error: undefined, resolved: ["/project/lib/bar.ts"] };
        }
      };

      const { rewrite } = createImportRewriter({ analyzeCode, importResolver });
      const result = await rewrite({ code, importer: "/project/src/main.ts" });

      assert.strictEqual(result.error, undefined);
      assert.strictEqual(result.rewrittenCode, `import foo from "../lib/bar.ts";`);
    });
  });
});
