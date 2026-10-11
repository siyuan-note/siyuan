const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const ts = require("typescript");
const {compileAnchoredInputRuntime, withAnchoredInputRuntime} = require("./fixtures/anchoredInputRuntime.cjs");

test("dialog fixtures load the real anchored input dependency graph", () => {
    const source = compileAnchoredInputRuntime();
    const api = new Function("return " + source)();
    assert.equal(api.getAnchoredInputMask(), undefined);
    assert.equal(api.closeAnchoredInput(false), undefined);
    assert.equal(typeof api.openAnchoredInput, "function");
    assert.throws(() => new Function("return " + source.replace('"./anchoredInputPosition":', '"./missingPosition":'))(),
        /Unexpected anchored input fixture module/);
});

test("dialog fixture wrapper preserves strict external dependency resolution", () => {
    const source = ts.transpileModule(readFileSync(path.join(__dirname, "../src/dialog/index.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    const imports = [];
    const allowed = new Set(["../util/genID", "../util/zIndex", "./moveResize", "../util/functions",
        "../protyle/util/compatibility", "../constants", "../block/panelOwnership"]);
    const exports = {};
    new Function("require", "exports", withAnchoredInputRuntime(source))(name => {
        assert.ok(allowed.has(name), "Unexpected dialog fixture dependency: " + name);
        imports.push(name);
        return {};
    }, exports);
    assert.equal(typeof exports.Dialog, "function");
    assert.equal(imports.includes("./anchoredInput"), false);
    assert.equal(imports.length, allowed.size);
    assert.throws(() => new Function("require", "exports", withAnchoredInputRuntime('require("./unexpected")'))(
        name => { throw new Error("Unmocked dependency: " + name); }, {}), /Unmocked dependency: \.\/unexpected/);
});
