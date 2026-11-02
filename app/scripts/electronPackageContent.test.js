const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");

const appRoot = path.join(__dirname, "..");
// 打包输入必须是构建产物目录：源码目录 electron/ 与测试同目录，直接打包会把测试带入安装包。
const OUTPUT_DIR = "electron-dist";
// 产物清单与构建脚本共用同一份来源，漏项会在构建与校验两侧同时暴露。
const {rendererScripts, staticAssets} = require("./electronPackageContent");
// electron-builder-common.yml 只被 extends 引用，本身不含入口与 files，不是独立的打包配置。
const SHARED_BUILDER_CONFIG = "electron-builder-common.yml";
const builderConfigs = fs.readdirSync(appRoot)
    .filter(name => /^electron-builder.*\.yml$/.test(name) && name !== SHARED_BUILDER_CONFIG).sort();

const readScalar = (lines, key) => {
    const line = lines.find(item => new RegExp("^\\s*" + key + ":\\s*\"").test(item));
    const match = line && /^\s*[^:]+:\s*"([^"]+)"/.exec(line);
    return match ? match[1] : undefined;
};

// files 段是缩进的短横线列表，遇到第一条非列表行即结束。
const readFilesEntries = (lines) => {
    const start = lines.findIndex(line => /^files:\s*$/.test(line));
    assert.notEqual(start, -1, "缺少 files 段");
    const entries = [];
    for (const line of lines.slice(start + 1)) {
        const match = /^\s+-\s+"?([^"\s]+)"?\s*$/.exec(line);
        if (!match) {
            break;
        }
        entries.push(match[1]);
    }
    return entries;
};

test("every desktop packaging config reads the build output instead of the source directory", () => {
    assert.ok(builderConfigs.length > 0, "未找到 electron-builder 配置");
    for (const name of builderConfigs) {
        const lines = fs.readFileSync(path.join(appRoot, name), "utf8").split(/\r?\n/);
        const entries = readFilesEntries(lines);
        assert.deepEqual(entries, [OUTPUT_DIR], `${name} 的 files 必须只包含 ${OUTPUT_DIR}`);
        assert.equal(readScalar(lines, "main"), OUTPUT_DIR + "/main.js", `${name} 的入口必须指向产物目录`);
    }
});

test("package entry points at the build output", () => {
    const pkg = require(path.join(appRoot, "package.json"));
    assert.equal(pkg.main, "./" + OUTPUT_DIR + "/main.js");
    for (const name of ["start", "start:simulate-rosetta", "build:electron"]) {
        assert.ok(pkg.scripts[name], `缺少 ${name} 脚本`);
    }
    assert.match(pkg.scripts.start, /electron-dist\/main\.js/);
    // 打包命令自身先产出产物：builder 只读产物目录，单独跑 dist 时不会再有别的构建步骤。
    const distScripts = Object.keys(pkg.scripts).filter(name => /^dist/.test(name));
    assert.ok(distScripts.length > 0, "未找到 dist 脚本");
    for (const name of distScripts) {
        assert.match(pkg.scripts[name], /pnpm run build:electron/, `${name} 必须先构建产物`);
    }
});

test("build output excludes tests and ships every runtime asset", (t) => {
    const outputDir = path.join(appRoot, OUTPUT_DIR);
    if (!fs.existsSync(outputDir)) {
        t.skip("尚未构建，先运行 pnpm run build:electron");
        return;
    }
    const names = fs.readdirSync(outputDir);
    assert.deepEqual(names.filter(name => /\.test\./.test(name)), [], "产物目录不能包含测试文件");
    assert.equal(names.includes("fixtures"), false, "产物目录不能包含仅测试使用的 fixtures");
    // 静态资源与渲染脚本位于 static/，主进程入口仍在产物根目录。
    assert.ok(fs.existsSync(path.join(outputDir, "main.js")), "产物缺少 main.js");
    assert.ok(fs.statSync(path.join(outputDir, "main.js")).size > 0, "产物中的 main.js 为空");
    const staticDir = path.join(outputDir, "static");
    assert.ok(fs.existsSync(staticDir), "产物缺少 static 目录");
    const staticNames = fs.readdirSync(staticDir);
    assert.deepEqual(staticNames.filter(name => /\.test\./.test(name)), [], "static 目录不能包含测试文件");
    for (const name of [...rendererScripts, ...staticAssets]) {
        const file = path.join(staticDir, name);
        assert.ok(fs.existsSync(file), `产物缺少 static/${name}`);
        assert.ok(fs.statSync(file).size > 0, `产物中的 static/${name} 为空`);
    }
});
