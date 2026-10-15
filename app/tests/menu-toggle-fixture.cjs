const {readFileSync} = require("node:fs");
const {join} = require("node:path");
const {runInNewContext} = require("node:vm");
const {transpileModule, ModuleKind, ScriptTarget} = require("typescript");

exports.loadMenuToggle = globals => {
    const exports = {};
    const source = readFileSync(join(__dirname, "../src/menus/menuToggle.ts"), "utf8");
    runInNewContext(transpileModule(source, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText, {...globals, exports});
    return exports;
};

exports.menuAnchor = () => ({
    marked: false,
    closest() { return this.marked ? this : null; },
    setAttribute() { this.marked = true; },
});
