const {readFileSync} = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const compileAnchoredInputRuntime = () => {
    const sources = Object.fromEntries(["anchoredInput", "anchoredInputPosition"].map(name => ["./" + name,
        ts.transpileModule(readFileSync(path.join(__dirname, "../../src/dialog", name + ".ts"), "utf8"), {
            compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
        }).outputText]));
    // 保留输入层及定位实现，只隔离系统键盘桥；未知依赖立即报错。
    return `(() => {
        const sources = ${JSON.stringify(sources)};
        const modules = {"../mobile/util/mobileAppUtil": {callMobileAppShowKeyboard() {}}};
        const load = name => {
            if (Object.hasOwn(modules, name)) return modules[name];
            if (!Object.hasOwn(sources, name)) throw new Error("Unexpected anchored input fixture module: " + name);
            const exports = {};
            modules[name] = exports;
            new Function("require", "exports", sources[name])(load, exports);
            return exports;
        };
        return load("./anchoredInput");
    })()`;
};

const withAnchoredInputRuntime = source => `
    const anchoredInputRuntime = ${compileAnchoredInputRuntime()};
    const parentRequire = require;
    require = name => name === "./anchoredInput" ? anchoredInputRuntime : parentRequire(name);
    ${source}`;

module.exports = {compileAnchoredInputRuntime, withAnchoredInputRuntime};
