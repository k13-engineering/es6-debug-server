import assert from "node:assert/strict";
import { describe, it } from "mocha";
import { createImportResolver } from "./import-resolver.ts";
import type { TResolveImportPathFunc } from "./import-resolver.ts";

describe("createImportResolver", () => {
  describe("resolveAllImports", () => {
    it("returns empty resolved array when no specifiers are given", async () => {
      let callCount = 0;
      const resolveImportPath: TResolveImportPathFunc = async () => {
        callCount += 1;
        return { error: undefined, filePath: "/some/path.ts" };
      };
      const { resolveAllImports } = createImportResolver({ resolveImportPath });

      const result = await resolveAllImports({ importer: "/root/file.ts", specifiers: [] });

      assert.strictEqual(callCount, 0);
      assert.strictEqual(result.error, undefined);
      assert.deepStrictEqual(result.resolved, []);
    });

    it("resolves a single specifier successfully", async () => {
      const resolveImportPath: TResolveImportPathFunc = async ({ specifier }) => {
        return {
          error: undefined,
          filePath: `/resolved/${specifier}`
        };
      };
      const { resolveAllImports } = createImportResolver({ resolveImportPath });

      const result = await resolveAllImports({ importer: "/root/file.ts", specifiers: ["./foo.ts"] });

      assert.strictEqual(result.error, undefined);
      assert.deepStrictEqual(result.resolved, ["/resolved/./foo.ts"]);
    });

    it("passes the correct importer and specifier to resolveImportPath", async () => {
      let calls: Array<{ importer: string; specifier: string }> = [];
      const resolveImportPath: TResolveImportPathFunc = async ({ importer, specifier }) => {
        calls = [...calls, { importer, specifier }];
        return { error: undefined, filePath: "/resolved.ts" };
      };
      const { resolveAllImports } = createImportResolver({ resolveImportPath });

      await resolveAllImports({ importer: "/root/file.ts", specifiers: ["./foo.ts"] });

      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0]!.importer, "/root/file.ts");
      assert.strictEqual(calls[0]!.specifier, "./foo.ts");
    });

    it("resolves multiple specifiers in input order", async () => {
      const resolveImportPath: TResolveImportPathFunc = async ({ specifier }) => {
        return {
          error: undefined,
          filePath: `/resolved/${specifier}`
        };
      };
      const { resolveAllImports } = createImportResolver({ resolveImportPath });

      const result = await resolveAllImports({
        importer: "/root/file.ts",
        specifiers: ["./a.ts", "./b.ts", "./c.ts"]
      });

      assert.strictEqual(result.error, undefined);
      assert.deepStrictEqual(result.resolved, [
        "/resolved/./a.ts",
        "/resolved/./b.ts",
        "/resolved/./c.ts"
      ]);
    });

    it("deduplicates specifiers before calling resolveImportPath", async () => {
      let calls: string[] = [];
      const resolveImportPath: TResolveImportPathFunc = async ({ specifier }) => {
        calls = [...calls, specifier];
        return { error: undefined, filePath: `/resolved/${specifier}` };
      };
      const { resolveAllImports } = createImportResolver({ resolveImportPath });

      await resolveAllImports({
        importer: "/root/file.ts",
        specifiers: ["./a.ts", "./b.ts", "./a.ts"]
      });

      assert.deepStrictEqual(calls, ["./a.ts", "./b.ts"]);
    });

    it("maps duplicate specifiers back to the same resolved path at original positions", async () => {
      const resolveImportPath: TResolveImportPathFunc = async ({ specifier }) => {
        return {
          error: undefined,
          filePath: `/resolved/${specifier}`
        };
      };
      const { resolveAllImports } = createImportResolver({ resolveImportPath });

      const result = await resolveAllImports({
        importer: "/root/file.ts",
        specifiers: ["./b.ts", "./a.ts", "./b.ts"]
      });

      assert.strictEqual(result.error, undefined);
      assert.deepStrictEqual(result.resolved, [
        "/resolved/./b.ts",
        "/resolved/./a.ts",
        "/resolved/./b.ts"
      ]);
    });

    it("returns an error when resolveImportPath fails for a specifier", async () => {
      const resolveImportPath: TResolveImportPathFunc = async () => {
        return { error: Error("module not found") };
      };
      const { resolveAllImports } = createImportResolver({ resolveImportPath });

      const result = await resolveAllImports({
        importer: "/root/file.ts",
        specifiers: ["./missing.ts"]
      });

      assert.notStrictEqual(result.error, undefined);
    });

    it("wraps the original error as the cause", async () => {
      const originalError = Error("module not found");
      const resolveImportPath: TResolveImportPathFunc = async () => {
        return { error: originalError };
      };
      const { resolveAllImports } = createImportResolver({ resolveImportPath });

      const result = await resolveAllImports({
        importer: "/root/file.ts",
        specifiers: ["./missing.ts"]
      });

      assert.strictEqual(result.error?.cause, originalError);
    });

    it("error message includes the failing specifier", async () => {
      const resolveImportPath: TResolveImportPathFunc = async () => {
        return { error: Error("module not found") };
      };
      const { resolveAllImports } = createImportResolver({ resolveImportPath });

      const result = await resolveAllImports({
        importer: "/root/file.ts",
        specifiers: ["./missing.ts"]
      });

      assert.ok(result.error?.message?.includes("./missing.ts"));
    });

    it("error message includes the importer", async () => {
      const resolveImportPath: TResolveImportPathFunc = async () => {
        return { error: Error("module not found") };
      };
      const { resolveAllImports } = createImportResolver({ resolveImportPath });

      const result = await resolveAllImports({
        importer: "/root/file.ts",
        specifiers: ["./missing.ts"]
      });

      assert.ok(result.error?.message?.includes("/root/file.ts"));
    });

    it("returns an error when one of multiple specifiers fails to resolve", async () => {
      const resolveImportPath: TResolveImportPathFunc = async ({ specifier }) => {
        if (specifier === "./missing.ts") {
          return { error: Error("module not found") };
        }
        return { error: undefined, filePath: `/resolved/${specifier}` };
      };
      const { resolveAllImports } = createImportResolver({ resolveImportPath });

      const result = await resolveAllImports({
        importer: "/root/file.ts",
        specifiers: ["./a.ts", "./missing.ts", "./b.ts"]
      });

      assert.notStrictEqual(result.error, undefined);
    });

    it("resolved is undefined when there is an error", async () => {
      const resolveImportPath: TResolveImportPathFunc = async () => {
        return { error: Error("module not found") };
      };
      const { resolveAllImports } = createImportResolver({ resolveImportPath });

      const result = await resolveAllImports({
        importer: "/root/file.ts",
        specifiers: ["./missing.ts"]
      });

      assert.strictEqual(result.resolved, undefined);
    });
  });
});
