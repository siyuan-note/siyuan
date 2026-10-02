const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const ts = require("typescript");
const {parse} = require("ifdef-loader/preprocessor");

test("shared editor sanitization remains bound after conditional preprocessing", () => {
    const source = readFileSync(path.join(__dirname, "../src/protyle/index.ts"), "utf8");
    for (const BROWSER of [false, true]) {
        for (const MOBILE of [false, true]) {
            const processed = parse(source, {BROWSER, MOBILE}, false, true);
            const file = ts.createSourceFile("index.ts", processed, ts.ScriptTarget.Latest, true);
            const imports = file.statements.filter(ts.isImportDeclaration);
            assert.ok(imports.some(statement =>
                statement.moduleSpecifier.text === "../util/hostCapabilities" &&
                statement.importClause?.namedBindings?.elements?.some(binding =>
                    binding.name.text === "sanitizeKernelHTML")), `BROWSER=${BROWSER}, MOBILE=${MOBILE}`);
        }
    }
});
